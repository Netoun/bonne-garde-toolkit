import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BINARY_FAVICONS, FAVICONS_DIR } from "./golden-project";

const ROOT = join(import.meta.dir, "..");
const PACKED = join(ROOT, "dist/npm/bonne-garde");
const REGISTRY = `local:${join(ROOT, "registry")}`;

/**
 * Node is the runtime these tests are about: `npx bonne-garde`, `pnpm dlx bonne-garde` and
 * `yarn dlx bonne-garde` all run the bin with it, so spawning it here is deliberate.
 */
const NODE = Bun.which("node");
const NPM_USER_AGENT = "npm/10.9.0 node/v22.12.0 darwin arm64";

async function spawn(argv: string[], cwd: string, env?: Record<string, string | undefined>) {
  const proc = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    ...(env === undefined ? {} : { env }),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("pack-cli", () => {
  const dirs: string[] = [];
  /** The packed package as a user has it: outside this repo, its dependencies installed. */
  let installed = "";

  beforeAll(async () => {
    const pack = await spawn(["bun", "scripts/pack-cli.ts"], ROOT);
    expect(pack.code).toBe(0);
    const parent = await mkdtemp(join(tmpdir(), "bg-pack-"));
    dirs.push(parent);
    installed = join(parent, "bonne-garde");
    await cp(PACKED, installed, { recursive: true });
    // What `npx bonne-garde` does first: fetch the packed package's own dependencies.
    expect((await spawn(["bun", "install"], installed)).code).toBe(0);
  }, 180_000);

  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  /** The packed bin, run by Node from `cwd`, started by the package manager `userAgent` names. */
  async function bonneGarde(cwd: string, ...args: string[]) {
    return startedBy(NPM_USER_AGENT, cwd, ...args);
  }

  async function startedBy(userAgent: string | undefined, cwd: string, ...args: string[]) {
    if (NODE === null) {
      throw new Error("node is not on PATH");
    }
    const { npm_config_user_agent: _ambient, ...env } = process.env;
    return spawn(
      [NODE, join(installed, "bin.js"), ...args],
      cwd,
      userAgent === undefined ? env : { ...env, npm_config_user_agent: userAgent },
    );
  }

  async function createdProject(name: string, ...args: string[]) {
    const parent = await mkdtemp(join(tmpdir(), "bg-pack-project-"));
    dirs.push(parent);
    const created = await bonneGarde(
      parent,
      "create",
      name,
      "--yes",
      "--no-git",
      "--no-install",
      ...args,
    );
    return { parent, project: join(parent, name), ...created };
  }

  test("names this repository exactly: npm trusted publishing refuses a package whose repository.url is another", async () => {
    const packed = await Bun.file(join(PACKED, "package.json")).json();

    expect(packed.repository.url).toBe("git+https://github.com/Netoun/bonne-garde-toolkit.git");
  });

  test("is the package bonne-garde, with the one bin bonne-garde: a JavaScript file for node", async () => {
    const packed = await Bun.file(join(PACKED, "package.json")).json();

    expect(packed.name).toBe("bonne-garde");
    expect(packed.version).toBe("0.1.0");
    expect(packed.bin).toEqual({ "bonne-garde": "./bin.js" });
    expect(packed.engines).toEqual({ node: ">=22.12.0" });
    expect(
      Object.values<string>(packed.dependencies).filter((v) => v.startsWith("workspace:")),
    ).toEqual([]);

    const bin = await Bun.file(join(PACKED, "bin.js")).text();
    expect(bin.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect((await stat(join(PACKED, "bin.js"))).mode & 0o111).not.toBe(0);
  });

  test("ships the bundle and the templates, and needs no TypeScript to run", async () => {
    expect((await readdir(PACKED)).sort()).toEqual([
      "LICENSE",
      "README.md",
      "bin.js",
      "package.json",
      "templates",
    ]);
    const bin = await Bun.file(join(PACKED, "bin.js")).text();
    // The workspace packages are in the bundle: nothing is imported by a workspace name or a relative path.
    expect(bin).not.toMatch(/from "@bonne-garde\//);
    expect(bin).not.toMatch(/from "\.{1,2}\//);
    expect(bin).not.toMatch(/\bBun\./);
    expect(bin).not.toContain("// @bun");
  });

  test("the README shows create with each runner and says the generated project needs Bun", async () => {
    const readme = await Bun.file(join(PACKED, "README.md")).text();

    for (const runner of ["bunx", "npx", "pnpm dlx", "yarn dlx"]) {
      expect(readme).toContain(`${runner} bonne-garde create my-app`);
    }
    expect(readme).toMatch(/needs \[Bun\]\(https:\/\/bun\.sh\)/);
    expect(readme).not.toContain("create-bonne-garde");
  });

  test("declares the npm dependencies of what it bundles, pinned as they are", async () => {
    const external: Record<string, string> = {};
    for (const name of ["cli", "registry", "schema"]) {
      const manifest = await Bun.file(join(ROOT, "packages", name, "package.json")).json();
      for (const [dependency, version] of Object.entries<string>(manifest.dependencies ?? {})) {
        if (!dependency.startsWith("@bonne-garde/")) {
          external[dependency] = version;
        }
      }
    }
    // Pinned to an exact version: a patch's output depends on what parses the file, and a copy
    // depends on what matches a glob.
    const exact = expect.stringMatching(/^\d+\.\d+\.\d+$/);
    expect(external).toEqual({
      "jsonc-parser": exact,
      picomatch: exact,
      tinyglobby: exact,
      "ts-morph": exact,
    });

    const packed = await Bun.file(join(PACKED, "package.json")).json();
    expect(packed.dependencies).toEqual(external);
  });

  test("`list` runs under node, and prints nothing node would warn about", async () => {
    const { stdout, stderr, code } = await bonneGarde(tmpdir(), "list", "--source", REGISTRY);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^button\t/m);
  });

  test("`list` runs under bun too", async () => {
    const { stdout, stderr, code } = await spawn(
      [process.execPath, join(installed, "bin.js"), "list", "--source", REGISTRY],
      tmpdir(),
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toMatch(/^button\t/m);
  });

  test("creates a project from the embedded templates", async () => {
    const { project, stderr, code } = await createdProject("packed-app", "--registry", REGISTRY);

    expect(stderr).toBe("");
    expect(code).toBe(0);
    const manifest = await Bun.file(join(project, "bg.json")).json();
    expect(manifest.version).toBe(2);
    expect(manifest.scope).toBe("@packed-app");
  });

  test("outside the repo, create pins the platform version and the github registry of that tag", async () => {
    const { project, stderr, code } = await createdProject("pinned-app");

    expect(stderr).toBe("");
    expect(code).toBe(0);
    const manifest = await Bun.file(join(project, "bg.json")).json();
    expect(manifest.platform.version).toBe("0.1.0");
    expect(manifest.registries["@bg"]).toBe("github:Netoun/bonne-garde-toolkit@v0.1.0");
  });

  test("names, in the commands it prints, the runner of the package manager that started it", async () => {
    const { project, code } = await createdProject("runner-app", "--registry", REGISTRY);
    expect(code).toBe(0);

    for (const [userAgent, runner] of [
      ["npm/10.9.0 node/v22.12.0 darwin arm64", "npx bonne-garde"],
      ["pnpm/9.12.0 npm/? node/v22.12.0 darwin arm64", "pnpm dlx bonne-garde"],
      ["yarn/4.5.0 npm/? node/v22.12.0 darwin arm64", "yarn dlx bonne-garde"],
      ["bun/1.4.4 npm/? node/v22.12.0 darwin arm64", "bunx bonne-garde"],
      [undefined, "npx bonne-garde"],
    ] as const) {
      // An item that needs the ui module is refused with the command that installs both.
      const refused = await startedBy(userAgent, project, "add", "button", "--yes", "--no-install");
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain(`run: ${runner} add ui/shadcn button`);
    }
  });

  test("copies the binary favicons of config/branding byte for byte", async () => {
    const { project, code } = await createdProject("icons-app", "--registry", REGISTRY);
    expect(code).toBe(0);
    const added = await bonneGarde(project, "add", "config/branding", "--yes", "--no-install");
    expect(added.code).toBe(0);
    // `add` expands the copy globs of the module, which is where a node warning would come from.
    expect(added.stderr).not.toContain("Warning");

    for (const name of BINARY_FAVICONS) {
      const source = join(ROOT, "registry/modules/config/branding/template", FAVICONS_DIR, name);
      const copied = await Bun.file(join(project, FAVICONS_DIR, name)).bytes();
      expect(copied.length).toBeGreaterThan(0);
      expect(Buffer.from(copied).equals(await Bun.file(source).bytes())).toBe(true);
    }
  });

  test("create without bun on PATH writes the project and says it needs Bun, from node too", async () => {
    if (NODE === null) {
      throw new Error("node is not on PATH");
    }
    const parent = await mkdtemp(join(tmpdir(), "bg-pack-no-bun-"));
    dirs.push(parent);
    const emptyPath = await mkdtemp(join(tmpdir(), "bg-pack-no-path-"));
    dirs.push(emptyPath);

    const { stdout, stderr, code } = await spawn(
      [NODE, join(installed, "bin.js"), "create", "no-bun-app", "--yes", "--registry", REGISTRY],
      parent,
      { ...process.env, PATH: emptyPath },
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("needs Bun (https://bun.sh)");
    expect(stderr).not.toContain("ENOENT");
    expect(await Bun.file(join(parent, "no-bun-app/bg.json")).exists()).toBe(true);
  });
});
