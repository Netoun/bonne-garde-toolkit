import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveGithubRaw, type GithubRawServer } from "@bonne-garde/registry/testing";
import { addItems, listItems, searchItems, viewItem } from "./add";
import { createProject } from "./create";
import { findRepoRoot, platformPackageVersion } from "./paths";

const REGISTRY_DIR = join(findRepoRoot() ?? "", "registry");
const REF = "feat/platform-cli-registry";
const SOURCE = `github:acme/bg@${REF}`;

const dirs: string[] = [];
const servers: GithubRawServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function serve(ref = REF): GithubRawServer {
  const server = serveGithubRaw({ registryDir: REGISTRY_DIR, ownerRepo: "acme/bg", ref });
  servers.push(server);
  return server;
}

async function project(registry: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "bg-gh-"));
  dirs.push(parent);
  return createProject({
    name: "gh-app",
    cwd: parent,
    git: false,
    install: false,
    registry,
    scope: "@gh",
  });
}

/** Every file under `root` with its text, so two trees compare whole. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true })) {
    const path = join(root, entry);
    if ((await stat(path)).isFile()) {
      out[entry] = await readFile(path, "utf8");
    }
  }
  return out;
}

type BgJson = {
  registries: Record<string, string>;
  items: Record<string, { source: string; installedAt: string }>;
  modules: Record<string, { id: string; installedAt: string }[]>;
  files: Record<string, { owner: string; sha256: string }>;
};

async function readBg(root: string): Promise<BgJson> {
  return JSON.parse(await readFile(join(root, "bg.json"), "utf8")) as BgJson;
}

/** What two installs of the same thing must share: `bg.json` less where it was read from and when. */
function comparable(bg: BgJson) {
  const stripped = JSON.parse(
    JSON.stringify(bg).replace(/"installedAt":"[^"]*"/g, '"installedAt":"-"'),
  ) as BgJson;
  return {
    ...stripped,
    registries: {},
    items: Object.fromEntries(
      Object.entries(stripped.items).map(([name, record]) => [name, { ...record, source: "-" }]),
    ),
  };
}

const LOCAL = `local:${REGISTRY_DIR}`;

describe("bg add from a github source", () => {
  test("installs an item and its dependencies, and records the source as given", async () => {
    const raw = serve();
    const root = await project(SOURCE);

    const { plan, result } = await addItems({
      projectRoot: root,
      items: ["ui/shadcn", "button"],
      install: false,
      github: { baseUrl: raw.baseUrl },
    });

    expect(plan.items.map((item) => item.name)).toEqual(["utils", "animations", "button"]);
    expect(await readFile(join(root, "packages/ui/src/components/button.tsx"), "utf8")).toContain(
      "function Button(",
    );
    expect(result.written).toContain("packages/ui/src/components/button.tsx");
    const bg = await readBg(root);
    expect(bg.items.button?.source).toBe(`${SOURCE}/button`);
    expect(bg.items.utils?.source).toBe(`${SOURCE}/utils`);
    expect(bg.registries["@bg"]).toBe(SOURCE);
  });

  test("an item that needs the ui module fails without it, naming ui/shadcn: github lists no modules to name it from", async () => {
    const raw = serve();
    const root = await project(SOURCE);
    const before = await snapshot(root);

    const failure = await addItems({
      projectRoot: root,
      items: ["button"],
      install: false,
      github: { baseUrl: raw.baseUrl },
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe(
      "button needs the ui module, and none is installed or named in this call; run: bg add ui/shadcn button",
    );
    expect(await snapshot(root)).toEqual(before);
  });

  test("replaces @acme in what it fetched, as a local install does", async () => {
    const raw = serve();
    const root = await project(SOURCE);
    await addItems({
      projectRoot: root,
      items: ["api-elysia"],
      install: false,
      github: { baseUrl: raw.baseUrl },
    });
    const manifest = await readFile(join(root, "apps/api/package.json"), "utf8");
    expect(manifest).toContain("@gh/");
    expect(manifest).not.toContain("@acme");
  });

  test("installs a module by its qualified name and by its bare name", async () => {
    for (const name of ["provider/cloudflare", "cloudflare"]) {
      const raw = serve();
      const root = await project(SOURCE);

      const { modulePlans } = await addItems({
        projectRoot: root,
        items: [name],
        install: false,
        github: { baseUrl: raw.baseUrl },
      });

      expect(modulePlans.map((module) => module.key)).toEqual(["provider/cloudflare"]);
      expect(await readFile(join(root, "apps/api/wrangler.jsonc"), "utf8")).toContain("name");
      const bg = await readBg(root);
      expect(bg.modules.provider?.map((record) => record.id)).toEqual(["cloudflare"]);
      expect(bg.files["apps/api/wrangler.jsonc"]?.owner).toBe("provider/cloudflare");
      expect(await readFile(join(root, ".env.example"), "utf8")).toContain("BETTER_AUTH_SECRET=");
    }
  });

  test("lists, searches and views the items of the registry, includes followed", async () => {
    const raw = serve();
    const root = await project(SOURCE);
    const github = { baseUrl: raw.baseUrl };

    const listed = await listItems(root, undefined, github);
    expect(listed.map((item) => item.name)).toEqual(
      expect.arrayContaining(["button", "utils", "api-elysia"]),
    );
    expect((await searchItems(root, "button", undefined, github)).map((i) => i.name)).toContain(
      "button",
    );
    expect((await viewItem(root, "button", undefined, github)).name).toBe("button");
  });

  test("a project from a github source and one from a local source end up the same", async () => {
    const everyItem = (await listItems(await project(LOCAL))).map((item) => item.name);
    for (const names of [
      ["ui/shadcn", ...everyItem],
      ["provider/cloudflare"],
      ["provider/dockerfile"],
      ["ui/shadcn"],
    ]) {
      const raw = serve();
      const fromGithub = await project(SOURCE);
      const fromLocal = await project(LOCAL);

      const remote = await addItems({
        projectRoot: fromGithub,
        items: names,
        install: false,
        github: { baseUrl: raw.baseUrl },
      });
      const local = await addItems({ projectRoot: fromLocal, items: names, install: false });

      expect(remote.result.written.sort()).toEqual(local.result.written.sort());
      expect(remote.result.written.length).toBeGreaterThan(0);
      expect(await snapshot(fromGithub)).toEqual({
        ...(await snapshot(fromLocal)),
        "bg.json": expect.any(String),
      });
      expect(comparable(await readBg(fromGithub))).toEqual(comparable(await readBg(fromLocal)));
    }
  });

  test("a file the registry lacks fails the whole install and leaves the tree and bg.json as they were", async () => {
    const cases = [
      "ui/button.tsx",
      "modules/provider/cloudflare/template/apps/api/wrangler.jsonc",
      "modules/ui/shadcn/template/packages/ui/package.json",
    ];
    for (const missing of cases) {
      const raw = serve();
      const root = await project(SOURCE);
      const before = await snapshot(root);
      raw.missing.add(missing);

      const failure = await addItems({
        projectRoot: root,
        items: ["ui/shadcn", "button", "provider/cloudflare"],
        install: false,
        github: { baseUrl: raw.baseUrl },
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain(missing.split("/").slice(-1)[0] ?? "");
      expect((failure as Error).message).toContain(SOURCE);
      expect(await snapshot(root)).toEqual(before);
    }
  });

  test("--dry-run fetches what the plan needs, writes nothing, and does not fetch the rest", async () => {
    const raw = serve();
    const root = await project(SOURCE);
    const before = await snapshot(root);
    raw.requested.length = 0;

    const { result } = await addItems({
      projectRoot: root,
      items: ["ui/shadcn", "button", "provider/cloudflare"],
      dryRun: true,
      install: false,
      github: { baseUrl: raw.baseUrl },
    });

    expect(result.written).toContain("packages/ui/src/components/button.tsx");
    expect(result.written).toContain("apps/api/wrangler.jsonc");
    expect(await snapshot(root)).toEqual(before);
    expect(raw.requested).toContain("ui/button.tsx");
    expect(raw.requested).toContain("ui/utils.ts");
    expect(raw.requested).toContain("modules/provider/cloudflare/template/apps/api/wrangler.jsonc");
    expect(raw.requested).toContain("modules/ui/shadcn/template/packages/ui/package.json");
    expect(raw.requested).not.toContain("ui/card.tsx");
    expect(raw.requested).not.toContain("apps/api-elysia/src/app.ts");
  });

  test("an unknown ref names the ref and carries no stack trace", async () => {
    const raw = serve();
    const root = await project(`github:acme/bg@v9.9.9`);
    const before = await snapshot(root);

    const failure = await addItems({
      projectRoot: root,
      items: ["button"],
      install: false,
      github: { baseUrl: raw.baseUrl },
    }).catch((error: unknown) => error);

    expect((failure as Error).message).toContain("github:acme/bg@v9.9.9");
    expect((failure as Error).message).not.toContain("\n    at ");
    expect(await snapshot(root)).toEqual(before);
  });

  test("a source with no ref reads the platform tag of bg.json", async () => {
    const tag = `v${platformPackageVersion()}`;
    const raw = serve(tag);
    const root = await project("github:acme/bg");

    await addItems({
      projectRoot: root,
      items: ["ui/shadcn", "button"],
      install: false,
      github: { baseUrl: raw.baseUrl },
    });

    expect(raw.requested).toContain("ui/button.tsx");
    expect((await readBg(root)).items.button?.source).toBe("github:acme/bg/button");
  });

  test("a source with no ref and a platform version of 0.0.0 asks for a pinned ref", async () => {
    const raw = serve();
    const root = await project("github:acme/bg");
    const bg = JSON.parse(await readFile(join(root, "bg.json"), "utf8")) as {
      platform: { version: string };
    };
    bg.platform.version = "0.0.0";
    await writeFile(join(root, "bg.json"), `${JSON.stringify(bg, null, 2)}\n`);

    await expect(
      addItems({
        projectRoot: root,
        items: ["button"],
        install: false,
        github: { baseUrl: raw.baseUrl },
      }),
    ).rejects.toThrow(/pin a ref/);
    expect(raw.requested).toEqual([]);
  });

  test("sends the token it is given", async () => {
    const raw = serve();
    const root = await project(SOURCE);
    await addItems({
      projectRoot: root,
      items: ["ui/shadcn", "button"],
      install: false,
      github: { baseUrl: raw.baseUrl, token: "t0ken" },
    });
    expect(new Set(raw.authorization)).toEqual(new Set(["Bearer t0ken"]));
  });
});
