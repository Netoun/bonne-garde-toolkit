import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { sha256Hex } from "@bonne-garde/registry";
import { serveGithubRaw, type GithubRawServer } from "@bonne-garde/registry/testing";
import { addItems } from "./add";
import { createProject } from "./create";
import { findRepoRoot } from "./paths";

/**
 * A template file that is not valid UTF-8 (035) is a binary file: copied byte for byte, never
 * rendered, recorded and checked by the sha256 of its bytes. This runs the real `bg` against a
 * registry on disk with one such file, the way a consumer does.
 */

// A PNG signature, the placeholder as ASCII, and the byte 0xff, which UTF-8 text cannot hold.
const ICON = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...Buffer.from("{{SCOPE}}"), 0xff, 0x00]);
// The same but for that byte: both decode to one text, and only the bytes tell them apart.
const LOOKALIKE = Uint8Array.from(ICON, (byte) => (byte === 0xff ? 0xfe : byte));
const ICON_PATH = "packages/icons/icon.png";

const dirs: string[] = [];
const servers: GithubRawServer[] = [];

afterAll(async () => {
  for (const server of servers) {
    server.stop();
  }
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function put(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** A registry with one module, `config/icons`: a text file that names the scope, and `ICON`. */
async function iconsRegistry(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bg-binary-registry-"));
  dirs.push(root);
  await put(join(root, "registry.json"), JSON.stringify({ name: "icons", items: [] }));
  const module = join(root, "modules/config/icons");
  await put(
    join(module, "module.json"),
    JSON.stringify({
      id: "icons",
      category: "config",
      title: "Icons",
      description: "One text file and one icon.",
      variants: [
        {
          key: "default",
          match: {},
          copy: ["packages/icons/index.ts", ICON_PATH],
        },
      ],
    }),
  );
  await put(
    join(module, "template/packages/icons/index.ts"),
    'export const scope = "{{SCOPE}}";\n',
  );
  await put(join(module, "template", ICON_PATH), ICON);
  return root;
}

async function project(registry?: string): Promise<string> {
  const source = registry ?? `local:${await iconsRegistry()}`;
  const parent = await mkdtemp(join(tmpdir(), "bg-binary-project-"));
  dirs.push(parent);
  return createProject({
    name: "icons-app",
    cwd: parent,
    git: false,
    install: false,
    scope: "@shop",
    registry: source,
  });
}

/** Runs the real `bg` entry in `cwd`. */
async function bg(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", join(findRepoRoot() ?? "", "packages/cli/src/bin.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const ADD = ["add", "config/icons", "--yes", "--no-install"];

const bytesOf = async (root: string) => Buffer.from(await readFile(join(root, ICON_PATH)));

describe("bg add of a module with a binary template file", () => {
  test("--dry-run lists the file with the others and writes nothing", async () => {
    const root = await project();

    const { stdout, code } = await bg(root, ...ADD, "--dry-run");

    expect(code).toBe(0);
    const printed = JSON.parse(stdout);
    expect(printed.modules[0].files).toEqual([ICON_PATH, "packages/icons/index.ts"]);
    expect(printed.written).toContain(ICON_PATH);
    expect(await Bun.file(join(root, ICON_PATH)).exists()).toBe(false);
  });

  test("copies the bytes as they are, renders the text beside it, and records the sha256 of the bytes", async () => {
    const root = await project();

    const { code } = await bg(root, ...ADD);

    expect(code).toBe(0);
    expect((await bytesOf(root)).equals(ICON)).toBe(true);
    expect(await readFile(join(root, "packages/icons/index.ts"), "utf8")).toBe(
      'export const scope = "@shop";\n',
    );
    const recorded = JSON.parse(await readFile(join(root, "bg.json"), "utf8"));
    expect(recorded.files[ICON_PATH]).toEqual({ owner: "config/icons", sha256: sha256Hex(ICON) });
  });

  test("doctor --strict is green, and a second add skips the file and changes nothing", async () => {
    const root = await project();
    await bg(root, ...ADD);
    const bgJson = await readFile(join(root, "bg.json"), "utf8");

    expect((await bg(root, "doctor", "--strict")).code).toBe(0);
    const again = await bg(root, ...ADD);

    expect(again.code).toBe(0);
    const printed = JSON.parse(again.stdout);
    expect(printed.written).toEqual([]);
    expect(printed.skippedIdentical).toContain(ICON_PATH);
    expect((await bytesOf(root)).equals(ICON)).toBe(true);
    expect(
      (await readFile(join(root, "bg.json"), "utf8")).replace(/"installedAt": "[^"]*"/g, ""),
    ).toBe(bgJson.replace(/"installedAt": "[^"]*"/g, ""));
  });

  test("a changed byte is the user's: doctor names the file, add fails on it, and --force restores it", async () => {
    const root = await project();
    await bg(root, ...ADD);
    await writeFile(join(root, ICON_PATH), LOOKALIKE);

    const strict = await bg(root, "doctor", "--strict", "--json");
    expect(strict.code).toBe(1);
    expect(JSON.parse(strict.stdout).checks.files.details.modified).toEqual([ICON_PATH]);

    const refused = await bg(root, ...ADD);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`${ICON_PATH} was modified since config/icons wrote it`);
    expect((await bytesOf(root)).equals(LOOKALIKE)).toBe(true);

    expect((await bg(root, ...ADD, "--force")).code).toBe(0);
    expect((await bytesOf(root)).equals(ICON)).toBe(true);
    expect((await bg(root, "doctor", "--strict")).code).toBe(0);
  });
});

describe("a module with a binary template file, read over github:", () => {
  test("arrives byte for byte: the file is fetched as bytes, not as text", async () => {
    const server = serveGithubRaw({
      registryDir: await iconsRegistry(),
      ownerRepo: "acme/bg",
      ref: "v1",
    });
    servers.push(server);
    const root = await project("github:acme/bg@v1");

    await addItems({
      projectRoot: root,
      items: ["config/icons"],
      install: false,
      github: { baseUrl: server.baseUrl },
    });

    expect((await bytesOf(root)).equals(ICON)).toBe(true);
    expect(await readFile(join(root, "packages/icons/index.ts"), "utf8")).toBe(
      'export const scope = "@shop";\n',
    );
    const recorded = JSON.parse(await readFile(join(root, "bg.json"), "utf8"));
    expect(recorded.files[ICON_PATH].sha256).toBe(sha256Hex(ICON));
  });
});
