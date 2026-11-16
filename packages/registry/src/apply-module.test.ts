import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  createEmptyProjectManifest,
  parseProjectManifest,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { ApplyError, applyInstallPlan } from "./apply-plan";
import type { ModulePlan } from "./module-plan";
import { sha256Hex } from "./sha256";
import type { RegistryItem } from "./types";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = () => "2026-02-02T00:00:00.000Z";

function modulePlan(overrides: Partial<ModulePlan> = {}): ModulePlan {
  return {
    category: "provider",
    id: "cloudflare",
    key: "provider/cloudflare",
    variant: "default",
    options: {},
    files: [{ target: "apps/api/wrangler.jsonc", content: '{ "name": "api" }\n' }],
    binaries: [],
    env: [],
    patches: [],
    intentions: [],
    dependencies: {},
    devDependencies: {},
    workspace: null,
    checks: [],
    ...overrides,
  };
}

function libItem(name: string, files: Record<string, string>): RegistryItem {
  return {
    name,
    type: "registry:lib",
    files: Object.entries(files).map(([target, content]) => ({
      path: `${name}/${target}`,
      type: "registry:file",
      target,
      content,
    })),
  };
}

const NO_ITEMS = {
  items: [],
  npmDependencies: [],
  npmDevDependencies: [],
};

async function freshProject(): Promise<{ projectRoot: string; manifest: ProjectManifest }> {
  const parent = await mkdtemp(join(tmpdir(), "bg-applymod-"));
  dirs.push(parent);
  const projectRoot = join(parent, "project");
  await mkdir(projectRoot);
  return {
    projectRoot,
    manifest: createEmptyProjectManifest({
      scope: "@demo",
      registries: {},
      platformVersion: "0.3.0",
    }),
  };
}

/** Every path under `root` with its content, so two trees compare whole. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out[`${relative(root, path)}/`] = "<dir>";
        await walk(path);
      } else {
        out[relative(root, path)] = await readFile(path, "utf8");
      }
    }
  };
  await walk(root);
  return out;
}

async function install(
  projectRoot: string,
  manifest: ProjectManifest,
  modules: ModulePlan[],
  extra: { force?: boolean; dryRun?: boolean } = {},
) {
  return applyInstallPlan({
    projectRoot,
    manifest,
    plan: NO_ITEMS,
    modules,
    sourceLabel: "@bg",
    now: NOW,
    ...extra,
  });
}

describe("applyInstallPlan: modules (050 steps 10-12)", () => {
  test("writes the variant's files and records the module and every file with its owner and sha256", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [
      modulePlan({
        files: [
          { target: "Dockerfile", content: "FROM bun\n" },
          { target: "packages/rt/src/index.ts", content: "export {};\n" },
        ],
        options: { withOrg: false },
      }),
    ]);

    expect(result.written).toEqual(["Dockerfile", "packages/rt/src/index.ts"]);
    expect(await readFile(join(projectRoot, "Dockerfile"), "utf8")).toBe("FROM bun\n");
    expect(result.manifest.modules.provider).toEqual([
      {
        id: "cloudflare",
        variant: "default",
        version: "0.3.0",
        installedAt: "2026-02-02T00:00:00.000Z",
        options: { withOrg: false },
        patches: [],
        intentions: { applied: [], skipped: {} },
      },
    ]);
    expect(result.manifest.files).toEqual({
      Dockerfile: { owner: "provider/cloudflare", sha256: sha256Hex("FROM bun\n") },
      "packages/rt/src/index.ts": {
        owner: "provider/cloudflare",
        sha256: sha256Hex("export {};\n"),
      },
    });
    const onDisk = JSON.parse(await readFile(join(projectRoot, "bg.json"), "utf8")) as unknown;
    expect(parseProjectManifest(onDisk)).toEqual(result.manifest);
  });

  test("--dry-run reports the same result and writes nothing", async () => {
    const { projectRoot, manifest } = await freshProject();
    await writeFile(join(projectRoot, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await snapshot(projectRoot);

    const result = await install(
      projectRoot,
      manifest,
      [modulePlan({ env: [{ name: "SECRET", required: true, example: "" }] })],
      { dryRun: true },
    );

    expect(result.written).toEqual(["apps/api/wrangler.jsonc"]);
    expect(result.manifest.modules.provider?.[0]?.id).toBe("cloudflare");
    expect(result.env?.added).toEqual([{ name: "SECRET", owner: "provider/cloudflare" }]);
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("a second add of the same module skips every file and keeps one record", async () => {
    const { projectRoot, manifest } = await freshProject();
    const plan = modulePlan({ env: [{ name: "SECRET", required: true, example: "" }] });
    const first = await install(projectRoot, manifest, [plan]);
    const treeAfterFirst = await snapshot(projectRoot);

    const second = await install(projectRoot, first.manifest, [plan]);

    expect(second.written).toEqual([]);
    expect(second.skippedIdentical).toEqual(["apps/api/wrangler.jsonc"]);
    expect(second.env).toEqual({ file: ".env.example", added: [], present: ["SECRET"] });
    expect(second.manifest.modules.provider).toHaveLength(1);
    expect(second.manifest.files).toEqual(first.manifest.files);
    expect(second.manifest.regions).toEqual(first.manifest.regions);
    expect(await snapshot(projectRoot)).toEqual(treeAfterFirst);
  });

  test("a re-add keeps the intentions already recorded for the module", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [modulePlan()]);
    const recorded = parseProjectManifest({
      ...first.manifest,
      modules: {
        provider: [
          {
            ...first.manifest.modules.provider?.[0],
            intentions: { applied: ["provider/cloudflare/wire-it"], skipped: {} },
          },
        ],
      },
    });

    const second = await install(projectRoot, recorded, [modulePlan()]);

    expect(second.manifest.modules.provider?.[0]?.intentions).toEqual({
      applied: ["provider/cloudflare/wire-it"],
      skipped: {},
    });
  });

  test("a changed template overwrites a file nobody touched, and keeps a user's edit unless forced", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [
      modulePlan({
        files: [
          { target: "a.txt", content: "v1" },
          { target: "b.txt", content: "v1" },
        ],
      }),
    ]);
    await writeFile(join(projectRoot, "b.txt"), "edited by the user");
    const next = modulePlan({
      files: [
        { target: "a.txt", content: "v2" },
        { target: "b.txt", content: "v2" },
      ],
    });
    const before = await snapshot(projectRoot);

    await expect(install(projectRoot, first.manifest, [next])).rejects.toThrow(
      /b\.txt.*modified since provider\/cloudflare wrote it/s,
    );
    expect(await snapshot(projectRoot)).toEqual(before);

    const forced = await install(projectRoot, first.manifest, [next], { force: true });
    expect(forced.written).toEqual(["a.txt", "b.txt"]);
    expect(await readFile(join(projectRoot, "b.txt"), "utf8")).toBe("v2");

    // a.txt alone, untouched since it was written, is overwritten without --force.
    const { projectRoot: other, manifest: otherManifest } = await freshProject();
    const firstA = await install(other, otherManifest, [
      modulePlan({ files: [{ target: "a.txt", content: "v1" }] }),
    ]);
    const updated = await install(other, firstA.manifest, [
      modulePlan({ files: [{ target: "a.txt", content: "v2" }] }),
    ]);
    expect(updated.written).toEqual(["a.txt"]);
    expect(updated.manifest.files["a.txt"]?.sha256).toBe(sha256Hex("v2"));
  });

  test("a file bg.json does not record fails every collision at once, and writes nothing", async () => {
    const { projectRoot, manifest } = await freshProject();
    await mkdir(join(projectRoot, "apps/api"), { recursive: true });
    await writeFile(join(projectRoot, "apps/api/wrangler.jsonc"), "mine");
    await writeFile(join(projectRoot, "Dockerfile"), "mine too");
    const before = await snapshot(projectRoot);

    const attempt = install(projectRoot, manifest, [
      modulePlan({
        files: [
          { target: "Dockerfile", content: "theirs" },
          { target: "apps/api/wrangler.jsonc", content: "theirs" },
          { target: "fresh.txt", content: "new" },
        ],
      }),
    ]);

    await expect(attempt).rejects.toBeInstanceOf(ApplyError);
    await expect(attempt).rejects.toThrow(
      /--force.*Dockerfile.*not recorded.*apps\/api\/wrangler\.jsonc.*not recorded/s,
    );
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("--force overwrites an unrecorded file and records the module as its owner", async () => {
    const { projectRoot, manifest } = await freshProject();
    await writeFile(join(projectRoot, "Dockerfile"), "mine");

    const result = await install(
      projectRoot,
      manifest,
      [modulePlan({ files: [{ target: "Dockerfile", content: "theirs" }] })],
      { force: true },
    );

    expect(await readFile(join(projectRoot, "Dockerfile"), "utf8")).toBe("theirs");
    expect(result.manifest.files.Dockerfile).toEqual({
      owner: "provider/cloudflare",
      sha256: sha256Hex("theirs"),
    });
    expect(result.tookOver).toEqual([]);
  });

  test("a file another owner recorded fails naming both owners, and --force takes it over, loudly", async () => {
    const { projectRoot, manifest } = await freshProject();
    const withItem = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: {
        ...NO_ITEMS,
        items: [libItem("api-elysia", { "apps/api/wrangler.jsonc": "minimal" })],
      },
      sourceLabel: "@bg",
    });
    const before = await snapshot(projectRoot);

    await expect(install(projectRoot, withItem.manifest, [modulePlan()])).rejects.toThrow(
      /apps\/api\/wrangler\.jsonc is owned by api-elysia, and provider\/cloudflare would replace it/,
    );
    expect(await snapshot(projectRoot)).toEqual(before);

    const forced = await install(projectRoot, withItem.manifest, [modulePlan()], { force: true });
    expect(forced.tookOver).toEqual([
      { path: "apps/api/wrangler.jsonc", from: "api-elysia", by: "provider/cloudflare" },
    ]);
    expect(forced.manifest.files["apps/api/wrangler.jsonc"]?.owner).toBe("provider/cloudflare");
  });

  test("a file another owner recorded and the user deleted is re-created, and the change of owner is reported", async () => {
    const { projectRoot, manifest } = await freshProject();
    const withItem = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: {
        ...NO_ITEMS,
        items: [libItem("api-elysia", { "apps/api/wrangler.jsonc": "minimal" })],
      },
      sourceLabel: "@bg",
    });
    await rm(join(projectRoot, "apps/api/wrangler.jsonc"));

    const result = await install(projectRoot, withItem.manifest, [modulePlan()]);

    expect(result.written).toEqual(["apps/api/wrangler.jsonc"]);
    expect(result.tookOver).toEqual([
      { path: "apps/api/wrangler.jsonc", from: "api-elysia", by: "provider/cloudflare" },
    ]);
    expect(result.manifest.files["apps/api/wrangler.jsonc"]?.owner).toBe("provider/cloudflare");
  });

  test("an item and a module naming one file in the same call fail, and --force does not decide between them", async () => {
    const { projectRoot, manifest } = await freshProject();

    await expect(
      applyInstallPlan({
        projectRoot,
        manifest,
        plan: {
          ...NO_ITEMS,
          items: [libItem("api-elysia", { "apps/api/wrangler.jsonc": "minimal" })],
        },
        modules: [modulePlan()],
        sourceLabel: "@bg",
        force: true,
      }),
    ).rejects.toThrow(
      /apps\/api\/wrangler\.jsonc is named by both api-elysia and provider\/cloudflare/,
    );
    expect(await snapshot(projectRoot)).toEqual({});
  });

  test("a write error midway, items and modules together, leaves no file and the old bg.json", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [modulePlan()]);
    await writeFile(join(projectRoot, "blocker"), "a file in the way");
    const before = await snapshot(projectRoot);

    await expect(
      applyInstallPlan({
        projectRoot,
        manifest: first.manifest,
        plan: { ...NO_ITEMS, items: [libItem("greeting", { "src/greeting.ts": "x" })] },
        modules: [
          modulePlan({
            category: "tooling",
            id: "fmt",
            key: "tooling/fmt",
            files: [
              { target: "tooling/config.json", content: "{}" },
              { target: "blocker/last.json", content: "{}" },
            ],
          }),
        ],
        sourceLabel: "@bg",
      }),
    ).rejects.toThrow();

    expect(await snapshot(projectRoot)).toEqual(before);
  });
});

describe("applyInstallPlan: binary files (035)", () => {
  // A PNG signature, the placeholder as ASCII, and the byte 0xff, which UTF-8 text cannot hold.
  const ICON = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...Buffer.from("{{SCOPE}}"), 0xff, 0x00]);
  // The same but for that byte. Read as UTF-8, both decode to the same text, so a comparison of
  // decoded text cannot tell them apart and a comparison of bytes can.
  const LOOKALIKE = Uint8Array.from(ICON, (byte) => (byte === 0xff ? 0xfe : byte));
  const TARGET = "assets/icon.png";

  const withIcon = (bytes: Uint8Array) =>
    modulePlan({ files: [], binaries: [{ target: TARGET, bytes }] });
  const onDisk = async (root: string) => Buffer.from(await readFile(join(root, TARGET)));

  /** Every file of a tree by the sha256 of its bytes: a snapshot of text would call two lookalikes equal. */
  async function hashes(root: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for await (const path of new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })) {
      out[path] = sha256Hex(await readFile(join(root, path)));
    }
    return out;
  }

  test("is written byte for byte, and bg.json records the sha256 of its bytes", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [withIcon(ICON)]);

    expect((await onDisk(projectRoot)).equals(ICON)).toBe(true);
    expect(result.written).toEqual([TARGET]);
    expect(result.manifest.files[TARGET]).toEqual({
      owner: "provider/cloudflare",
      sha256: sha256Hex(ICON),
    });
  });

  test("--dry-run lists it and writes nothing", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [withIcon(ICON)], { dryRun: true });

    expect(result.written).toEqual([TARGET]);
    expect(await hashes(projectRoot)).toEqual({});
  });

  test("a second add skips it and changes nothing", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [withIcon(ICON)]);
    const before = await hashes(projectRoot);

    const second = await install(projectRoot, first.manifest, [withIcon(ICON)]);

    expect(second.written).toEqual([]);
    expect(second.skippedIdentical).toEqual([TARGET]);
    expect(second.manifest.files).toEqual(first.manifest.files);
    expect(await hashes(projectRoot)).toEqual(before);
  });

  test("a changed template overwrites a file nobody touched", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [withIcon(ICON)]);

    const updated = await install(projectRoot, first.manifest, [withIcon(LOOKALIKE)]);

    expect(updated.written).toEqual([TARGET]);
    expect((await onDisk(projectRoot)).equals(LOOKALIKE)).toBe(true);
    expect(updated.manifest.files[TARGET]?.sha256).toBe(sha256Hex(LOOKALIKE));
  });

  test("an edit of one byte is the user's: a re-add fails naming the file, and --force overwrites it", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [withIcon(ICON)]);
    await writeFile(join(projectRoot, TARGET), LOOKALIKE);
    const before = await hashes(projectRoot);

    await expect(install(projectRoot, first.manifest, [withIcon(ICON)])).rejects.toThrow(
      /assets\/icon\.png was modified since provider\/cloudflare wrote it/,
    );
    expect(await hashes(projectRoot)).toEqual(before);

    const forced = await install(projectRoot, first.manifest, [withIcon(ICON)], { force: true });
    expect(forced.written).toEqual([TARGET]);
    expect((await onDisk(projectRoot)).equals(ICON)).toBe(true);
  });

  test("a file bg.json does not record is refused when its bytes differ, and recorded when they are the same", async () => {
    const { projectRoot, manifest } = await freshProject();
    await mkdir(join(projectRoot, "assets"));
    await writeFile(join(projectRoot, TARGET), LOOKALIKE);
    const before = await hashes(projectRoot);

    await expect(install(projectRoot, manifest, [withIcon(ICON)])).rejects.toThrow(
      /assets\/icon\.png exists and is not recorded in bg\.json/,
    );
    expect(await hashes(projectRoot)).toEqual(before);

    await writeFile(join(projectRoot, TARGET), ICON);
    const result = await install(projectRoot, manifest, [withIcon(ICON)]);
    expect(result.skippedIdentical).toEqual([TARGET]);
    expect(result.manifest.files[TARGET]?.sha256).toBe(sha256Hex(ICON));
  });

  test("one named by two modules in the same call fails, and --force does not decide between them", async () => {
    const { projectRoot, manifest } = await freshProject();

    await expect(
      install(
        projectRoot,
        manifest,
        [
          withIcon(ICON),
          modulePlan({
            category: "tooling",
            id: "fmt",
            key: "tooling/fmt",
            files: [],
            binaries: [{ target: TARGET, bytes: ICON }],
          }),
        ],
        { force: true },
      ),
    ).rejects.toThrow(/assets\/icon\.png is named by both provider\/cloudflare and tooling\/fmt/);
    expect(await hashes(projectRoot)).toEqual({});
  });
});

describe("applyInstallPlan: module env keys", () => {
  const SECRET = { name: "SECRET", required: true, example: "" };
  const PORT = { name: "PORT", required: false, example: "5172" };

  test("creates .env.example, one NAME=example line per key, and records each key as a region", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [modulePlan({ env: [SECRET, PORT] })]);

    expect(await readFile(join(projectRoot, ".env.example"), "utf8")).toBe("SECRET=\nPORT=5172\n");
    expect(result.env).toEqual({
      file: ".env.example",
      added: [
        { name: "SECRET", owner: "provider/cloudflare" },
        { name: "PORT", owner: "provider/cloudflare" },
      ],
      present: [],
    });
    expect(result.manifest.regions).toEqual({
      ".env.example": { SECRET: "provider/cloudflare", PORT: "provider/cloudflare" },
    });
    // A merged file is shared and project-owned: it is not a tier-1 record.
    expect(result.manifest.files[".env.example"]).toBeUndefined();
  });

  test("keeps what the file already holds: an existing key is never overwritten nor claimed", async () => {
    const { projectRoot, manifest } = await freshProject();
    await writeFile(join(projectRoot, ".env.example"), "# mine\nexport SECRET=hunter2\nOTHER=1");

    const result = await install(projectRoot, manifest, [modulePlan({ env: [SECRET, PORT] })]);

    expect(await readFile(join(projectRoot, ".env.example"), "utf8")).toBe(
      "# mine\nexport SECRET=hunter2\nOTHER=1\nPORT=5172\n",
    );
    expect(result.env?.present).toEqual(["SECRET"]);
    expect(result.manifest.regions).toEqual({ ".env.example": { PORT: "provider/cloudflare" } });
  });

  test("two modules in one call share the file, and the second finds the first's keys present", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [
      modulePlan({ env: [SECRET] }),
      modulePlan({
        category: "auth",
        id: "better-auth",
        key: "auth/better-auth",
        files: [{ target: "packages/auth/src/index.ts", content: "export {};\n" }],
        env: [SECRET, { name: "AUTH_URL", required: false, example: "" }],
      }),
    ]);

    expect(await readFile(join(projectRoot, ".env.example"), "utf8")).toBe("SECRET=\nAUTH_URL=\n");
    expect(result.manifest.regions[".env.example"]).toEqual({
      SECRET: "provider/cloudflare",
      AUTH_URL: "auth/better-auth",
    });
  });

  test("a module with no env keys leaves .env.example alone", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [modulePlan()]);

    expect(result.env).toBeNull();
    await expect(stat(join(projectRoot, ".env.example"))).rejects.toThrow();
  });
});

describe("applyInstallPlan: a module's workspace package", () => {
  const withDeps = modulePlan({
    category: "auth",
    id: "better-auth",
    key: "auth/better-auth",
    files: [{ target: "packages/auth/package.json", content: '{ "name": "@demo/auth" }\n' }],
    dependencies: { "better-auth": "1.4.2" },
    workspace: "packages/auth",
  });

  test("is installed when the root package.json already lists a workspace glob covering it", async () => {
    const { projectRoot, manifest } = await freshProject();
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "demo", workspaces: ["apps/*", "packages/*"] }),
    );

    const result = await install(projectRoot, manifest, [withDeps]);

    expect(result.written).toEqual(["packages/auth/package.json"]);
  });

  test("is refused when no workspace glob covers it, since registering one is a patch", async () => {
    const { projectRoot, manifest } = await freshProject();
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "demo", workspaces: ["apps/*"] }),
    );
    const before = await snapshot(projectRoot);

    await expect(install(projectRoot, manifest, [withDeps])).rejects.toThrow(
      /auth\/better-auth: workspace packages\/auth is not covered by the workspaces of package\.json \(apps\/\*\): registering it is a workspace\.add patch, which is not supported yet/,
    );
    expect(await snapshot(projectRoot)).toEqual(before);
  });
});

describe("applyInstallPlan: the intentions a module authors (065, 050 step 14)", () => {
  const WIRE = {
    id: "provider/cloudflare/wire-it",
    module: "provider/cloudflare",
    title: "Wire it",
    document: "---\nid: provider/cloudflare/wire-it\n---\n\n# Wire it\n",
  };

  test("are reported pending, once per module that plans them, and record nothing in bg.json", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [modulePlan({ intentions: [WIRE] })]);

    expect(result.authored).toEqual([WIRE]);
    expect(result.pending).toEqual([]);
    expect(result.manifest.modules.provider?.[0]?.intentions).toEqual({ applied: [], skipped: {} });
  });

  test("are pending again on the next add, and not once bg.json records an outcome for them", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [modulePlan({ intentions: [WIRE] })]);

    expect(
      (await install(projectRoot, first.manifest, [modulePlan({ intentions: [WIRE] })])).authored,
    ).toEqual([WIRE]);

    const outcomes = [
      { applied: [WIRE.id], skipped: {} },
      { applied: [], skipped: { [WIRE.id]: "no auth module" } },
    ];
    for (const outcome of outcomes) {
      const resolved = parseProjectManifest({
        ...first.manifest,
        modules: {
          provider: first.manifest.modules.provider?.map((record) => ({
            ...record,
            intentions: outcome,
          })),
        },
      });

      const again = await install(projectRoot, resolved, [modulePlan({ intentions: [WIRE] })]);

      expect(again.authored).toEqual([]);
      expect(again.manifest.modules.provider?.[0]?.intentions).toEqual(outcome);
    }
  });

  test("a dry run reports them and writes nothing", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [modulePlan({ intentions: [WIRE] })], {
      dryRun: true,
    });

    expect(result.authored).toEqual([WIRE]);
    expect(await readdir(projectRoot)).toEqual([]);
  });
});
