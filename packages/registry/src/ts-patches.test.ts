import { describe, expect, test } from "bun:test";
import {
  addImport,
  addNamedExport,
  exportRegion,
  importRegion,
  inspectImport,
  inspectNamedExport,
} from "./ts-patches";

const APP = `import "elysia";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

export const app = new Elysia().use(cors());
`;

describe("ts.addImport: regions and inspection (060)", () => {
  test("the region of an import is the specifier, whatever the names", () => {
    expect(importRegion("@app/auth")).toBe("imports[@app/auth]");
    expect(exportRegion("./schema")).toBe("exports[./schema]");
  });

  test("absent when no name is imported from the specifier, equal when all are", () => {
    expect(inspectImport("app.ts", APP, "@app/auth", ["authModule"])).toEqual({
      ok: true,
      state: { kind: "absent" },
    });
    expect(inspectImport("app.ts", APP, "elysia", ["Elysia"])).toEqual({
      ok: true,
      state: { kind: "equal" },
    });
  });

  test("a superset is equal, and a name missing makes it absent", () => {
    const text = 'import { a, b, c } from "x";\n';

    expect(inspectImport("a.ts", text, "x", ["b", "a"])).toMatchObject({
      state: { kind: "equal" },
    });
    expect(inspectImport("a.ts", text, "x", ["b", "d"])).toMatchObject({
      state: { kind: "absent" },
    });
  });

  test("a name imported under another local name is not the name the module's code uses", () => {
    expect(inspectImport("a.ts", 'import { a as b } from "x";\n', "x", ["a"])).toMatchObject({
      state: { kind: "absent" },
    });
    expect(inspectImport("a.ts", 'import { a as a } from "x";\n', "x", ["a"])).toMatchObject({
      state: { kind: "equal" },
    });
  });

  test("a file that is not TypeScript cannot be patched, and says where it breaks", () => {
    const result = inspectImport("a.ts", "export const a = (;\n", "x", ["a"]);

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/^not valid TypeScript \(.* at line 1\)$/);
  });

  test("a .tsx file is read as TSX, and a .ts file is not", () => {
    const jsx = "export const a = <div>{1}</div>;\n";

    expect(inspectImport("a.tsx", jsx, "x", ["a"]).ok).toBe(true);
    expect(inspectImport("a.ts", jsx, "x", ["a"]).ok).toBe(false);
  });
});

describe("ts.addImport: addImport", () => {
  test("adds a declaration after the last import, and changes no other byte", () => {
    const after = addImport("app.ts", APP, "@app/auth", ["authModule"]);

    expect(after).toBe(
      APP.replace(
        'import { cors } from "@elysiajs/cors";\n',
        'import { cors } from "@elysiajs/cors";\nimport { authModule } from "@app/auth";\n',
      ),
    );
  });

  test("a trailing comment of the last import stays on its line", () => {
    const text = 'import a from "a"; // keep\n\nexport const b = 1;\n';

    expect(addImport("a.ts", text, "x", ["y"])).toBe(
      'import a from "a"; // keep\nimport { y } from "x";\n\nexport const b = 1;\n',
    );
  });

  test("a declaration that does not fit in 100 columns is written one name per line, as the formatter writes it", () => {
    const names = [
      "alphaaaaaaaaaaaaaaaaaaaaa",
      "bravoooooooooooooooooooo",
      "charlieeeeeeeeeeeeeeeeee",
    ];

    const after = addImport("a.ts", 'import a from "a";\n', "@app/some-long-package-name", names);

    expect(after).toBe(
      `import a from "a";\nimport {\n${names.map((name) => `  ${name},`).join("\n")}\n} from "@app/some-long-package-name";\n`,
    );
  });

  test("a file with no import gets it first, after a shebang, and a blank line", () => {
    expect(addImport("a.ts", "export const b = 1;\n", "x", ["y"])).toBe(
      'import { y } from "x";\n\nexport const b = 1;\n',
    );
    expect(addImport("a.ts", "#!/usr/bin/env bun\nexport const b = 1;\n", "x", ["y"])).toBe(
      '#!/usr/bin/env bun\nimport { y } from "x";\n\nexport const b = 1;\n',
    );
  });

  test("adds the names that are missing to the named import the file already has", () => {
    const text = 'import { a } from "x";\nimport { z } from "z";\n';

    expect(addImport("a.ts", text, "x", ["a", "b", "c"])).toBe(
      'import { a, b, c } from "x";\nimport { z } from "z";\n',
    );
  });

  test("keeps a default import and the semicolon-less end of a declaration it extends", () => {
    expect(addImport("a.ts", 'import X, { a } from "x"\n', "x", ["b"])).toBe(
      'import X, { a, b } from "x"\n',
    );
  });

  test("a named import that grows past 100 columns is rewritten one name per line", () => {
    const first = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const text = `import { ${first} } from "x";\n`;

    expect(addImport("a.ts", text, "x", ["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"])).toBe(
      `import {\n  ${first},\n  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,\n} from "x";\n`,
    );
  });

  test("a namespace import of the specifier is no place for a named one: a declaration of its own", () => {
    expect(addImport("a.ts", 'import * as x from "x";\n', "x", ["a"])).toBe(
      'import * as x from "x";\nimport { a } from "x";\n',
    );
  });

  test("a comment inside the braces it would rewrite is not worth losing: the patch fails, and says what to merge", () => {
    const text = 'import { a /* keep */ } from "x";\n';

    expect(inspectImport("a.ts", text, "x", ["b"])).toEqual({
      ok: false,
      reason: "a comment inside the braces of the import from x would be lost: merge b by hand",
    });
    expect(() => addImport("a.ts", text, "x", ["b"])).toThrow(
      /a comment inside the braces of the import from x/,
    );
  });

  test("keeps CRLF line endings", () => {
    expect(addImport("a.ts", 'import a from "a";\r\nexport {};\r\n', "x", ["y"])).toBe(
      'import a from "a";\r\nimport { y } from "x";\r\nexport {};\r\n',
    );
  });

  test("a second application changes nothing", () => {
    const once = addImport("app.ts", APP, "@app/auth", ["authModule", "other"]);

    expect(addImport("app.ts", once, "@app/auth", ["authModule", "other"])).toBe(once);
    expect(inspectImport("app.ts", once, "@app/auth", ["authModule", "other"])).toMatchObject({
      state: { kind: "equal" },
    });
  });
});

describe("ts.addNamedExport (060)", () => {
  const BARREL = `import { db } from "./db";

export { one } from "./one";
export * from "./all";

export const two = db;
`;

  test("adds `export { a, b } from` after the last export from a module, and changes no other byte", () => {
    expect(addNamedExport("index.ts", BARREL, "@app/auth/schema", ["users", "sessions"])).toBe(
      BARREL.replace(
        'export * from "./all";\n',
        'export * from "./all";\nexport { users, sessions } from "@app/auth/schema";\n',
      ),
    );
  });

  test("with no export from a module it goes after the imports, and with neither, first", () => {
    expect(addNamedExport("a.ts", 'import a from "a";\n\nexport const b = 1;\n', "x", ["y"])).toBe(
      'import a from "a";\nexport { y } from "x";\n\nexport const b = 1;\n',
    );
    expect(addNamedExport("a.ts", "export const b = 1;\n", "x", ["y"])).toBe(
      'export { y } from "x";\n\nexport const b = 1;\n',
    );
  });

  test("equal when every name is already exported from the specifier, under its own name", () => {
    expect(inspectNamedExport("i.ts", BARREL, "./one", ["one"])).toMatchObject({
      state: { kind: "equal" },
    });
    expect(
      inspectNamedExport("i.ts", 'export { one as two } from "./one";\n', "./one", ["one"]),
    ).toMatchObject({ state: { kind: "absent" } });
    expect(
      inspectNamedExport("i.ts", 'export { one as two } from "./one";\n', "./one", ["two"]),
    ).toMatchObject({ state: { kind: "equal" } });
  });

  test("an `export *` from the specifier exports every name: equal", () => {
    expect(inspectNamedExport("i.ts", BARREL, "./all", ["anything"])).toMatchObject({
      state: { kind: "equal" },
    });
  });

  test("adds the missing names to the export the file already has, in the formatter's layout", () => {
    expect(addNamedExport("i.ts", BARREL, "./one", ["one", "uno"])).toBe(
      BARREL.replace('export { one } from "./one";', 'export { one, uno } from "./one";'),
    );
  });

  test("a second application changes nothing", () => {
    const once = addNamedExport("i.ts", BARREL, "@app/auth/schema", ["users"]);

    expect(addNamedExport("i.ts", once, "@app/auth/schema", ["users"])).toBe(once);
  });
});
