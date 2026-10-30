import { describe, expect, test } from "bun:test";
import { parseProjectManifest, createEmptyProjectManifest } from "@bonne-garde/schema";
import { patchIntentId, patchIntentText } from "./pending-intentions";
import type { PlannedPatch } from "./patch-plan";

const USE = {
  type: "ts.elysiaUse",
  file: "apps/api/src/app.ts",
  targetName: "app",
  argument: "authModule",
} satisfies PlannedPatch;

describe("the id of the intention a failed patch becomes (065)", () => {
  test("is <category>/<module-id>/<slug>, the slug naming the patch by its type, file and first region", () => {
    expect(patchIntentId("auth/better-auth", USE)).toBe(
      "auth/better-auth/patch-ts-elysia-use-apps-api-src-app-ts-elysia-app-use-auth-module",
    );
    expect(
      patchIntentId("config/branding", {
        type: "scripts.merge",
        file: "package.json",
        scripts: { "gen:branding": "bun x.ts", other: "y" },
      }),
    ).toBe("config/branding/patch-scripts-merge-package-json-scripts-gen-branding");
    expect(
      patchIntentId("db/d1", {
        type: "jsonc.merge",
        file: "apps/api/wrangler.jsonc",
        value: { d1_databases: [] },
      }),
    ).toBe("db/d1/patch-jsonc-merge-apps-api-wrangler-jsonc-d1-databases");
  });

  test("is the same for the same patch however the module orders its patches, and differs for another", () => {
    const other = { ...USE, argument: "dbModule" };

    expect(patchIntentId("auth/better-auth", USE)).toBe(
      patchIntentId("auth/better-auth", { ...USE }),
    );
    expect(patchIntentId("auth/better-auth", other)).not.toBe(
      patchIntentId("auth/better-auth", USE),
    );
    expect(patchIntentId("auth/better-auth", { ...USE, file: "apps/web/src/app.ts" })).not.toBe(
      patchIntentId("auth/better-auth", USE),
    );
  });

  test("is an id the manifest records: every segment is kebab-case", () => {
    const id = patchIntentId("auth/better-auth", {
      type: "ts.addImport",
      file: "apps/api/src/App.TS",
      moduleSpecifier: "@app/Auth_Module",
      namedImports: ["authModule"],
    });
    const manifest = createEmptyProjectManifest({ scope: "@app", registries: {} });

    expect(() =>
      parseProjectManifest({
        ...manifest,
        modules: {
          auth: [
            {
              id: "better-auth",
              variant: "default",
              version: "0.0.0",
              installedAt: "2026-01-01T00:00:00.000Z",
              options: {},
              patches: [],
              intentions: { applied: [id], skipped: {} },
            },
          ],
        },
      }),
    ).not.toThrow();
    expect(id).toMatch(/^auth\/better-auth\/patch-ts-add-import-/);
  });
});

describe("what a failed patch tells whoever resolves it", () => {
  test("the module's own sentence when it declares one", () => {
    expect(
      patchIntentText("auth/better-auth", { ...USE, intent: "Register auth on the API" }),
    ).toBe("Register auth on the API");
  });

  test("else a sentence made from the patch: the file and every region with the value it declares", () => {
    expect(patchIntentText("auth/better-auth", USE)).toBe(
      "The ts.elysiaUse patch of auth/better-auth makes apps/api/src/app.ts hold: elysia[app].use[authModule] = .use(authModule).",
    );
    expect(
      patchIntentText("config/branding", {
        type: "scripts.merge",
        file: "package.json",
        scripts: { a: "x", b: "y" },
      }),
    ).toBe(
      'The scripts.merge patch of config/branding makes package.json hold: scripts.a = "x"; scripts.b = "y".',
    );
  });
});
