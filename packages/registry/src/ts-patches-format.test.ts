import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatWithProjectFormatter } from "../test-support/project-formatter";
import { addImport, addNamedExport } from "./ts-patches";

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

describe("ts.addImport writes what the formatter writes", () => {
  test("after the last import of the api/elysia seam", async () => {
    const text = await seam();
    await expectStable({ "app.ts": text });

    const patched = addImport("app.ts", text, "@app/auth", ["authModule"]);

    expect(patched).not.toBe(text);
    await expectStable({ "app.ts": patched });
  });

  test("a declaration over 100 columns, and an existing one that grows past it", async () => {
    const names = [
      "alphaaaaaaaaaaaaaaaaaaaaa",
      "bravoooooooooooooooooooo",
      "charlieeeeeeeeeeeeeeeeee",
    ];
    const first = addImport(
      "a.ts",
      'import a from "a";\n\nexport const b = a;\n',
      "@app/long-name",
      names,
    );
    const grown = addImport("b.ts", 'import { one } from "@app/x";\n', "@app/x", [
      "twooooooooooooooooooooooooooooooooooooooo",
      "threeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ]);

    await expectStable({ "a.ts": first, "b.ts": grown });
  });

  test("an existing declaration that gains a name and still fits, beside a default import", async () => {
    const merged = addImport("a.ts", 'import X, { a } from "x";\nexport { X, a };\n', "x", ["b"]);

    await expectStable({ "a.ts": merged });
  });

  test("a .tsx file", async () => {
    const text = 'import { useState } from "react";\n\nexport const A = () => <div />;\n';

    await expectStable({ "a.tsx": addImport("a.tsx", text, "@app/ui", ["Button"]) });
  });
});

describe("ts.addNamedExport writes what the formatter writes", () => {
  test("after the last re-export of a barrel, and as the first export of one that has none", async () => {
    const barrel =
      'import { db } from "./db";\n\nexport { one } from "./one";\nexport * from "./all";\n\nexport const two = db;\n';
    const bare = 'import { db } from "./db";\n\nexport const two = db;\n';

    await expectStable({
      "barrel.ts": addNamedExport("barrel.ts", barrel, "@app/auth/schema", ["users", "sessions"]),
      "bare.ts": addNamedExport("bare.ts", bare, "@app/auth/schema", ["users"]),
    });
  });

  test("a list over 100 columns, and an existing one that grows past it", async () => {
    const names = Array.from({ length: 5 }, (_, index) => `aVeryLongTableName${index}Schema`);
    const wide = addNamedExport("a.ts", 'export * from "./all";\n', "@app/auth/schema", names);
    const grown = addNamedExport("b.ts", 'export { one } from "./one";\n', "./one", names);

    await expectStable({ "a.ts": wide, "b.ts": grown });
  });
});
