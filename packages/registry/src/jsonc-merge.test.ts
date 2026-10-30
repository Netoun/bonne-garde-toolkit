import { describe, expect, test } from "bun:test";
import {
  inspectJsonc,
  jsonRegion,
  jsoncLeaves,
  parseJsonRegion,
  readJsonPath,
  setJsoncLeaves,
} from "./jsonc-merge";

const WRANGLER = `{
  "name": "my-app-api",
  // the runtime
  "compatibility_date": "2025-06-01",
  "vars": {
    "API_URL": "http://localhost:5172",
  },
}
`;

const D1 = [{ binding: "DB", database_name: "my-app", database_id: "local" }];

describe("jsonc.merge: the leaves of a value and their regions (060)", () => {
  test("every leaf is a dot-path, and an array is a leaf, written whole", () => {
    expect(jsoncLeaves({ a: 1, b: { c: "x", d: { e: null } }, f: [1, { g: 2 }] })).toEqual([
      { path: ["a"], value: 1 },
      { path: ["b", "c"], value: "x" },
      { path: ["b", "d", "e"], value: null },
      { path: ["f"], value: [1, { g: 2 }] },
    ]);
  });

  test("the region of a leaf is its path with dots, the same text scripts.merge claims", () => {
    expect(jsonRegion(["scripts", "gen:branding"])).toBe("scripts.gen:branding");
    expect(jsonRegion(["d1_databases"])).toBe("d1_databases");
  });

  test("a segment with a dot, a bracket, a quote or a backslash, or an empty one, is written as a JSON string", () => {
    expect(jsonRegion(["dependencies", "lodash.merge"])).toBe('dependencies."lodash.merge"');
    expect(jsonRegion(["exports", "./server", "import"])).toBe('exports."./server".import');
    expect(jsonRegion(["a[0]"])).toBe('"a[0]"');
    expect(jsonRegion(['a"b', "c\\d", ""])).toBe('"a\\"b"."c\\\\d".""');
  });

  test("a region reads back to its path, and a key that is not a path reads as none", () => {
    for (const path of [
      ["scripts", "gen:branding"],
      ["dependencies", "lodash.merge"],
      ['a"b', "c\\d", ""],
    ]) {
      expect(parseJsonRegion(jsonRegion(path))).toEqual(path);
    }
    for (const key of ["imports[./x]", "elysia[app].use[x]", "a..b", "", ".a", "a."]) {
      expect(parseJsonRegion(key)).toBeNull();
    }
  });
});

describe("jsonc.merge: inspectJsonc", () => {
  const leaves = jsoncLeaves({ name: "my-app-api", vars: { API_URL: "x", NEW: "y" }, d1: D1 });

  test("tells absent, equal and differing leaves apart, comparing arrays by value", () => {
    const text = `{ "name": "my-app-api", "vars": { "API_URL": "z" }, "d1": ${JSON.stringify(D1)} }`;

    expect(inspectJsonc(text, leaves)).toEqual({
      ok: true,
      states: new Map([
        ["name", { kind: "equal" }],
        ["vars.API_URL", { kind: "differs", current: '"z"', shown: '"z"' }],
        ["vars.NEW", { kind: "absent" }],
        ["d1", { kind: "equal" }],
      ]),
    });
  });

  test("an array that is not the declared one differs, with its text", () => {
    const result = inspectJsonc('{ "d1": [] }', jsoncLeaves({ d1: D1 }));

    expect(result).toEqual({
      ok: true,
      states: new Map([["d1", { kind: "differs", current: "[]", shown: "[]" }]]),
    });
  });

  test("a leaf under a path that is missing is absent, and a value of another type differs", () => {
    expect(inspectJsonc("{}", jsoncLeaves({ a: { b: 1 } }))).toEqual({
      ok: true,
      states: new Map([["a.b", { kind: "absent" }]]),
    });
    expect(inspectJsonc('{ "a": { "b": "1" } }', jsoncLeaves({ a: { b: 1 } }))).toEqual({
      ok: true,
      states: new Map([["a.b", { kind: "differs", current: '"1"', shown: '"1"' }]]),
    });
  });

  test("comments and trailing commas are read as JSONC", () => {
    expect(inspectJsonc(WRANGLER, jsoncLeaves({ name: "my-app-api" }))).toEqual({
      ok: true,
      states: new Map([["name", { kind: "equal" }]]),
    });
  });

  test("a file that cannot hold the patch says why: not JSON, not an object, a parent that is not an object", () => {
    const wanted = jsoncLeaves({ a: { b: 1 } });
    const broken = inspectJsonc('{\n  "a": \n}\n', wanted);
    expect(broken.ok).toBe(false);
    expect(broken.ok ? "" : broken.reason).toMatch(/not valid JSON.*line 3/);
    expect(inspectJsonc("[]", wanted)).toEqual({
      ok: false,
      reason: "the root is not a JSON object",
    });
    expect(inspectJsonc('{ "a": "text" }', wanted)).toEqual({
      ok: false,
      reason: '"a" is a string, not an object',
    });
    expect(inspectJsonc('{ "a": { "b": [] } }', jsoncLeaves({ a: { b: { c: 1 } } }))).toEqual({
      ok: false,
      reason: '"a.b" is an array, not an object',
    });
  });
});

describe("jsonc.merge: setJsoncLeaves (jsonc-parser modify: only the inserted bytes change)", () => {
  test("adds an array after the last member, on lines of its own, keeping comments and trailing commas", () => {
    const after = setJsoncLeaves(WRANGLER, jsoncLeaves({ d1_databases: D1 }));

    expect(after).toBe(
      WRANGLER.replace(
        '    "API_URL": "http://localhost:5172",\n  },\n',
        `    "API_URL": "http://localhost:5172",\n  },\n  "d1_databases": [\n    {\n      "binding": "DB",\n      "database_name": "my-app",\n      "database_id": "local",\n    },\n  ],\n`,
      ),
    );
    expect(after).toContain("// the runtime");
  });

  test("a leaf in an existing object goes after its last member", () => {
    const after = setJsoncLeaves(
      WRANGLER,
      jsoncLeaves({ vars: { SPA_URL: "http://localhost:5173" } }),
    );

    expect(after).toBe(
      WRANGLER.replace(
        '"API_URL": "http://localhost:5172",\n',
        '"API_URL": "http://localhost:5172",\n    "SPA_URL": "http://localhost:5173",\n',
      ),
    );
  });

  test("missing parents are created, expanded, one level per line", () => {
    const text = '{\n  "name": "x"\n}\n';

    expect(setJsoncLeaves(text, jsoncLeaves({ env: { production: { vars: { A: "1" } } } }))).toBe(
      '{\n  "name": "x",\n  "env": {\n    "production": {\n      "vars": {\n        "A": "1"\n      }\n    }\n  }\n}\n',
    );
  });

  test("a file with no trailing commas gets none, and one that has them gets them", () => {
    const plain = '{\n  "a": 1\n}\n';
    const commas = '{\n  "a": 1,\n}\n';

    expect(setJsoncLeaves(plain, jsoncLeaves({ b: [1, 2], c: { d: 1 } }))).toBe(
      '{\n  "a": 1,\n  "b": [1, 2],\n  "c": {\n    "d": 1\n  }\n}\n',
    );
    expect(setJsoncLeaves(commas, jsoncLeaves({ b: [1, 2], c: { d: 1 } }))).toBe(
      '{\n  "a": 1,\n  "b": [1, 2],\n  "c": {\n    "d": 1,\n  },\n}\n',
    );
  });

  test("an array of scalars is on one line when it fits in 100 columns, and one per line when it does not", () => {
    const short = setJsoncLeaves("{}\n", jsoncLeaves({ flags: ["nodejs_compat", "other"] }));
    expect(short).toBe('{\n  "flags": ["nodejs_compat", "other"]\n}\n');

    const names = Array.from({ length: 6 }, (_, index) => `a-rather-long-name-number-${index}`);
    const long = setJsoncLeaves("{}\n", jsoncLeaves({ flags: names }));
    expect(long).toBe(
      `{\n  "flags": [\n${names.map((name) => `    "${name}"`).join(",\n")}\n  ]\n}\n`,
    );
  });

  test("replaces a leaf that differs, in place, and leaves everything around it", () => {
    const text = '{\n  // keep\n  "a": 1, /* and this */\n  "b": [\n    "x"\n  ]\n}\n';

    expect(setJsoncLeaves(text, jsoncLeaves({ a: 2, b: ["y", "z"] }))).toBe(
      '{\n  // keep\n  "a": 2, /* and this */\n  "b": ["y", "z"]\n}\n',
    );
  });

  test.each([
    ["two spaces", "  "],
    ["four spaces", "    "],
    ["tabs", "\t"],
  ])("indents like the file does: %s", (_, unit) => {
    const text = `{\n${unit}"a": {\n${unit}${unit}"b": 1\n${unit}}\n}\n`;

    expect(setJsoncLeaves(text, jsoncLeaves({ a: { c: { d: 1 } } }))).toBe(
      `{\n${unit}"a": {\n${unit}${unit}"b": 1,\n${unit}${unit}"c": {\n${unit}${unit}${unit}"d": 1\n${unit}${unit}}\n${unit}}\n}\n`,
    );
  });

  test("keeps CRLF line endings", () => {
    const text = '{\r\n  "a": 1\r\n}\r\n';

    const after = setJsoncLeaves(text, jsoncLeaves({ b: { c: 1 } }));

    expect(after).toBe('{\r\n  "a": 1,\r\n  "b": {\r\n    "c": 1\r\n  }\r\n}\r\n');
  });

  test("an object written on one line gets the leaf on that line, compact", () => {
    expect(setJsoncLeaves('{ "a": { "b": 1 } }\n', jsoncLeaves({ a: { c: [1, 2] } }))).toBe(
      '{ "a": { "b": 1, "c": [1, 2] } }\n',
    );
  });

  test("an empty object is filled on lines of its own", () => {
    expect(setJsoncLeaves("{}\n", jsoncLeaves({ k: "v" }))).toBe('{\n  "k": "v"\n}\n');
    expect(setJsoncLeaves('{\n  "a": {\n  }\n}\n', jsoncLeaves({ a: { k: "v" } }))).toBe(
      '{\n  "a": {\n    "k": "v"\n  }\n}\n',
    );
  });

  test("a second application changes nothing", () => {
    const leaves = jsoncLeaves({ d1_databases: D1, vars: { SPA_URL: "x" }, flags: ["a"] });
    const once = setJsoncLeaves(WRANGLER, leaves);

    expect(setJsoncLeaves(once, leaves)).toBe(once);
    expect(inspectJsonc(once, leaves)).toMatchObject({
      ok: true,
      states: new Map([
        ["d1_databases", { kind: "equal" }],
        ["vars.SPA_URL", { kind: "equal" }],
        ["flags", { kind: "equal" }],
      ]),
    });
  });

  test("a key with a dot is one key, not a path", () => {
    const after = setJsoncLeaves('{ "dependencies": {} }\n', [
      { path: ["dependencies", "lodash.merge"], value: "4.0.0" },
    ]);

    expect(JSON.parse(after)).toEqual({ dependencies: { "lodash.merge": "4.0.0" } });
  });
});

describe("jsonc.merge: readJsonPath (what doctor reads)", () => {
  test("tells whether a path is there, and why a file cannot be read", () => {
    expect(readJsonPath('{ "a": { "b": 1 } }', ["a", "b"])).toEqual({ ok: true, present: true });
    expect(readJsonPath('{ "a": { "b": 1 } }', ["a", "c"])).toEqual({ ok: true, present: false });
    expect(readJsonPath('{ "a": 1 }', ["a", "c"])).toEqual({ ok: true, present: false });
    expect(readJsonPath("nope", ["a"]).ok).toBe(false);
  });
});
