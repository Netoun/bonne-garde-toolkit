import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEmptyProjectManifest, parseProjectManifest } from "@bonne-garde/schema";
import { applyInstallPlan } from "./apply-plan";
import type { InstallPlan } from "./resolve-plan";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const plan: InstallPlan = {
  items: [
    {
      name: "greeting",
      type: "registry:lib",
      files: [
        { path: "greeting.ts", type: "registry:lib", target: "src/greeting.ts", content: "x" },
      ],
    },
  ],
  capabilities: [],
  npmDependencies: [],
  npmDevDependencies: [],
  transforms: [],
};

describe("applyInstallPlan", () => {
  test("records items under `items` and carries every other v2 field through", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "bg-apply-"));
    dirs.push(projectRoot);

    const sha256 = "b".repeat(64);
    const manifest = parseProjectManifest({
      ...createEmptyProjectManifest({ scope: "@acme", registries: {} }),
      apps: [{ id: "api", dir: "apps/api", kind: "worker" }],
      modules: {
        auth: [
          {
            id: "better-auth",
            variant: "default",
            version: "0.0.0",
            installedAt: "2026-01-01T00:00:00.000Z",
            options: {},
            patches: [],
            intentions: { applied: [], skipped: {} },
          },
        ],
      },
      files: { "packages/auth/src/index.ts": { owner: "auth/better-auth", sha256 } },
      regions: { "apps/api/src/app.ts": { "elysia[app].use[auth]": "auth/better-auth" } },
    });

    const { manifest: next } = await applyInstallPlan({
      projectRoot,
      manifest,
      plan,
      sourceLabel: "@bg",
      now: () => "2026-02-02T00:00:00.000Z",
    });

    expect(next.items.greeting).toEqual({
      source: "@bg/greeting",
      version: "0.0.0",
      installedAt: "2026-02-02T00:00:00.000Z",
    });
    expect(next.apps).toEqual(manifest.apps);
    expect(next.modules).toEqual(manifest.modules);
    expect(next.files).toEqual(manifest.files);
    expect(next.regions).toEqual(manifest.regions);

    const onDisk = JSON.parse(await readFile(join(projectRoot, "bg.json"), "utf8")) as unknown;
    expect(parseProjectManifest(onDisk)).toEqual(next);
  });
});
