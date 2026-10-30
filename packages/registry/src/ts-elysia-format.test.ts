import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatWithProjectFormatter } from "../test-support/project-formatter";
import { addElysiaUse, inspectElysiaUse } from "./ts-elysia";
import { addImport } from "./ts-patches";

/**
 * 060: what a patch writes is what the project's formatter writes, so `bun run check` passes right
 * after `bg add`. Each case patches a file the way a module will and hands the result to `vp fmt`.
 */

const ROOT = join(import.meta.dir, "../../..");
const seam = () =>
  readFile(join(ROOT, "registry/modules/api/elysia/template/apps/api/src/app.ts"), "utf8");

async function expectStable(files: Record<string, string>) {
  expect(await formatWithProjectFormatter(files)).toEqual(files);
}

describe("ts.elysiaUse writes what the formatter writes", () => {
  test("the api/elysia seam, with the import a module adds with it, and then a second module", async () => {
    const text = await seam();
    await expectStable({ "app.ts": text });

    const first = addElysiaUse(
      "app.ts",
      addImport("app.ts", text, "@app/auth", ["authModule"]),
      "app",
      "authModule",
    );
    const second = addElysiaUse(
      "app.ts",
      addImport("app.ts", first, "@app/db", ["dbModule"]),
      "app",
      "dbModule",
    );

    expect(first).toContain("  .use(authModule)\n");
    expect(second).toContain("  .use(authModule)\n  .use(dbModule)\n");
    await expectStable({ "first.ts": first, "second.ts": second });
  });

  test("a chain with no .use, and one that is `new Elysia()` alone", async () => {
    const routes =
      'export const app = new Elysia()\n  .get("/", () => 1)\n  .post("/", () => 2);\n';
    const bare = "export const app = new Elysia(runtimeOptions);\n";

    await expectStable({
      "routes.ts": addElysiaUse("routes.ts", routes, "app", "x"),
      "bare.ts": addElysiaUse("bare.ts", bare, "app", "x"),
    });
  });

  test("`new Elysia()` alone that would pass 100 columns is left to a human, not written past the formatter", () => {
    const text = `export const application = new Elysia({ name: "${"n".repeat(60)}" });\n`;

    expect(inspectElysiaUse("a.ts", text, "application", "authModule").ok).toBe(false);
  });
});
