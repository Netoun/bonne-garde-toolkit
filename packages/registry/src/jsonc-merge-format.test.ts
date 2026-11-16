import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { formatWithProjectFormatter } from "../test-support/project-formatter";
import { jsoncLeaves, setJsoncLeaves } from "./jsonc-merge";

/**
 * 060: what a patch writes is what the project's formatter writes, or `bun run check` fails right
 * after `bg add` and fixing it by hand makes `doctor` report the file as edited. Each case patches
 * a file the way a module will and hands the result to `vp fmt`.
 */

const ROOT = join(import.meta.dir, "../../..");
const wrangler = () =>
  readFile(join(ROOT, "registry/modules/api/elysia/template/apps/api/wrangler.jsonc"), "utf8");

const D1 = [{ binding: "DB", database_name: "my-app", database_id: "local" }];

async function expectStable(files: Record<string, string>) {
  expect(await formatWithProjectFormatter(files)).toEqual(files);
}

describe("jsonc.merge writes what the formatter writes", () => {
  test("wrangler.jsonc: an array of objects, a leaf in an existing object, a new object, a short array", async () => {
    const text = await wrangler();
    await expectStable({ "wrangler.jsonc": text });

    const patched = setJsoncLeaves(
      text,
      jsoncLeaves({
        d1_databases: D1,
        vars: { DB_URL: "file:local.db" },
        compatibility_flags: ["nodejs_compat", "nodejs_als"],
        observability: { enabled: true },
        env: { production: { d1_databases: D1 } },
      }),
    );

    expect(patched).not.toBe(text);
    await expectStable({ "wrangler.jsonc": patched });
  });

  test("a long array of scalars is one element per line, as the formatter breaks it", async () => {
    const names = Array.from({ length: 6 }, (_, index) => `a-rather-long-name-number-${index}`);

    const patched = setJsoncLeaves('{\n  "name": "x",\n}\n', jsoncLeaves({ names }));

    await expectStable({ "a.jsonc": patched });
  });

  test("a .json file gets no trailing commas", async () => {
    const text = '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n';

    const patched = setJsoncLeaves(
      text,
      jsoncLeaves({
        compilerOptions: { types: ["bun"], paths: { "@app/*": ["./src/*"] } },
        include: ["src/**/*.ts"],
      }),
    );

    await expectStable({ "tsconfig.json": text });
    await expectStable({ "tsconfig.json": patched });
  });

  test("a package.json: a script is added after the others, which the formatter leaves in order", async () => {
    const text = `{
  "name": "demo",
  "scripts": {
    "dev": "bun run dev"
  }
}
`;

    const patched = setJsoncLeaves(
      text,
      jsoncLeaves({ scripts: { build: "bun run build", a: "a" } }),
    );

    await expectStable({ "package.json": text });
    await expectStable({ "package.json": patched });
  });
});
