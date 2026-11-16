import { describe, expect, test } from "bun:test";
import {
  addElysiaUse,
  elysiaRegion,
  inspectElysiaUse,
  parseElysiaRegion,
  readElysiaRegion,
} from "./ts-elysia";

const SEAM = `import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

export const app = new Elysia(runtimeOptions)
  .use(
    cors({
      credentials: true,
    }),
  )
  .use(openapi())
  // Insertion point for the modules that plug into the API.
  .get("/health", () => ({ status: "ok" }));

export type App = typeof app;
`;

describe("ts.elysiaUse: region and inspection (060)", () => {
  test("the region names the variable and the argument, and reads back", () => {
    expect(elysiaRegion("app", "authModule")).toBe("elysia[app].use[authModule]");
    expect(parseElysiaRegion("elysia[app].use[authModule]")).toEqual({
      targetName: "app",
      argument: "authModule",
    });
    expect(parseElysiaRegion("imports[./x]")).toBeNull();
    expect(parseElysiaRegion("elysia[app]")).toBeNull();
  });

  test("absent while the chain has no such .use, equal once it has, wherever in the chain", () => {
    expect(inspectElysiaUse("app.ts", SEAM, "app", "authModule")).toEqual({
      ok: true,
      state: { kind: "absent" },
    });
    for (const text of [
      SEAM.replace("  .use(openapi())\n", "  .use(openapi())\n  .use(authModule)\n"),
      SEAM.replace('  .get("/health"', '  .use(authModule)\n  .get("/health"'),
      SEAM.replace(
        '  .get("/health", () => ({ status: "ok" }))',
        '  .get("/health", () => 1)\n  .use(authModule)',
      ),
    ]) {
      expect(inspectElysiaUse("app.ts", text, "app", "authModule")).toEqual({
        ok: true,
        state: { kind: "equal" },
      });
    }
  });

  test("a .use of something else with the same text inside is not the .use of the argument", () => {
    const text = SEAM.replace(
      "  .use(openapi())\n",
      "  .use(wrap(authModule))\n  .use(authModuleTwo)\n",
    );

    expect(inspectElysiaUse("app.ts", text, "app", "authModule")).toMatchObject({
      state: { kind: "absent" },
    });
  });

  test.each([
    ["the variable is missing", SEAM, "api", /^no exported const api$/],
    [
      "it is not exported",
      SEAM.replace("export const app", "const app"),
      "app",
      /^no exported const app$/,
    ],
    [
      "it is a let",
      SEAM.replace("export const app", "export let app"),
      "app",
      /^no exported const app$/,
    ],
    [
      "it is not built from new Elysia",
      SEAM.replace("new Elysia(runtimeOptions)", "createApp()"),
      "app",
      /^app is not a chain of calls rooted at new Elysia\(\.\.\.\)$/,
    ],
    [
      "it is rooted at another class",
      SEAM.replace("new Elysia(runtimeOptions)", "new Hono()"),
      "app",
      /^app is not a chain of calls rooted at new Elysia\(\.\.\.\)$/,
    ],
    [
      "it has no initializer",
      "export declare const app: Elysia;\n",
      "app",
      /^app is not a chain of calls rooted at new Elysia\(\.\.\.\)$/,
    ],
    [
      "the chain is on one line with calls in it, where the formatter would lay out another",
      'export const app = new Elysia().use(a).get("/", () => 1);\n',
      "app",
      /^app is a chain on one line: add \.use\(authModule\) by hand and let the formatter lay it out$/,
    ],
  ])("fails, not throws, when %s", (_, text, targetName, reason) => {
    const result = inspectElysiaUse("app.ts", text, targetName, "authModule");

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(reason);
  });

  test("fails on a file that is not TypeScript, saying where", () => {
    const result = inspectElysiaUse("app.ts", "export const app = (;\n", "app", "x");

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/^not valid TypeScript \(.* at line 1\)$/);
  });
});

describe("ts.elysiaUse: addElysiaUse", () => {
  test("adds the line after the last .use of the seam, above the comment, and changes no other byte", () => {
    const after = addElysiaUse("app.ts", SEAM, "app", "authModule");

    expect(after).toBe(
      SEAM.replace("  .use(openapi())\n", "  .use(openapi())\n  .use(authModule)\n"),
    );
  });

  test("a second module goes after the first one's, still before the routes", () => {
    const once = addElysiaUse("app.ts", SEAM, "app", "authModule");

    expect(addElysiaUse("app.ts", once, "app", "dbModule")).toBe(
      SEAM.replace(
        "  .use(openapi())\n",
        "  .use(openapi())\n  .use(authModule)\n  .use(dbModule)\n",
      ),
    );
  });

  test("a chain with no .use takes it before the first call, indented like it", () => {
    const text =
      'export const app = new Elysia()\n    .get("/", () => 1)\n    .post("/", () => 2);\n';

    expect(addElysiaUse("app.ts", text, "app", "x")).toBe(
      'export const app = new Elysia()\n    .use(x)\n    .get("/", () => 1)\n    .post("/", () => 2);\n',
    );
  });

  test("a chain that ends at its last .use gets the line after it, with the semicolon where it was", () => {
    const text = "export const app = new Elysia()\n  .use(a)\n  .use(b);\n";

    expect(addElysiaUse("app.ts", text, "app", "x")).toBe(
      "export const app = new Elysia()\n  .use(a)\n  .use(b)\n  .use(x);\n",
    );
  });

  test("a comment that trails the last .use stays on its line, and one after the semicolon stays after it", () => {
    const text = 'export const app = new Elysia()\n  .use(a) // the first\n  .get("/", () => 1);\n';
    const ended = "export const app = new Elysia()\n  .use(a)\n  .use(b); // last\n";

    expect(addElysiaUse("app.ts", text, "app", "x")).toBe(
      'export const app = new Elysia()\n  .use(a) // the first\n  .use(x)\n  .get("/", () => 1);\n',
    );
    expect(addElysiaUse("app.ts", ended, "app", "x")).toBe(
      "export const app = new Elysia()\n  .use(a)\n  .use(b)\n  .use(x); // last\n",
    );
  });

  test("`new Elysia()` alone takes the call on its own line", () => {
    expect(addElysiaUse("app.ts", "export const app = new Elysia();\n", "app", "x")).toBe(
      "export const app = new Elysia().use(x);\n",
    );
  });

  test("keeps the indentation unit of the file and its CRLF", () => {
    const text = 'export const app = new Elysia()\r\n\t.use(a)\r\n\t.get("/", () => 1);\r\n';

    expect(addElysiaUse("app.ts", text, "app", "x")).toBe(
      'export const app = new Elysia()\r\n\t.use(a)\r\n\t.use(x)\r\n\t.get("/", () => 1);\r\n',
    );
  });

  test("sees through a parenthesis, `satisfies` and `as`", () => {
    const text =
      "export const app = (new Elysia()\n  .use(a)\n  .get('/', () => 1)) satisfies Foo;\n";

    expect(addElysiaUse("app.ts", text, "app", "x")).toBe(
      "export const app = (new Elysia()\n  .use(a)\n  .use(x)\n  .get('/', () => 1)) satisfies Foo;\n",
    );
  });

  test("a second application changes nothing", () => {
    const once = addElysiaUse("app.ts", SEAM, "app", "authModule");

    expect(addElysiaUse("app.ts", once, "app", "authModule")).toBe(once);
  });
});

describe("ts.elysiaUse: readElysiaRegion (what doctor reads)", () => {
  test("tells whether the chain still has the .use, and why a file cannot be read", () => {
    const region = { targetName: "app", argument: "authModule" };
    const once = addElysiaUse("app.ts", SEAM, "app", "authModule");

    expect(readElysiaRegion("app.ts", once, region)).toEqual({ ok: true, present: true });
    expect(readElysiaRegion("app.ts", SEAM, region)).toEqual({ ok: true, present: false });
    expect(readElysiaRegion("app.ts", "export const app = (;\n", region).ok).toBe(false);
    expect(readElysiaRegion("app.ts", "export const other = 1;\n", region)).toEqual({
      ok: true,
      present: false,
    });
  });
});
