import { describe, expect, test } from "bun:test";
import { inspectScripts, readScripts, scriptRegion, setScripts } from "./scripts-merge";

const PACKAGE = `{
  "name": "demo",
  "scripts": {
    "dev": "bun run dev",
    "build": "bun run build"
  },
  "devDependencies": {}
}
`;

const wanted = { "gen:branding": "bun packages/config/scripts/gen-branding.ts" };

describe("scripts.merge: setScripts (060: jsonc-parser modify, formatting survives)", () => {
  test("adds the key after the existing ones and changes nothing else, byte for byte", () => {
    const after = setScripts(PACKAGE, wanted);

    expect(after).toBe(
      PACKAGE.replace(
        '    "build": "bun run build"\n',
        '    "build": "bun run build",\n    "gen:branding": "bun packages/config/scripts/gen-branding.ts"\n',
      ),
    );
  });

  test("leaves comments, trailing commas and unusual spacing where they are", () => {
    const text = `// the root of my app
{
  "name":   "demo", /* keep */
  "scripts": {
    "dev":"bun run dev", // watch
  },
  "private": true,
}
`;

    const after = setScripts(text, wanted);

    expect(after.replace(/,\n    "gen:branding": "[^"]*"/, "")).toBe(text);
    expect(after).toContain('"gen:branding": "bun packages/config/scripts/gen-branding.ts"');
  });

  test.each([
    ["two spaces", "  "],
    ["four spaces", "    "],
    ["tabs", "\t"],
  ])("indents the new key like the file does: %s", (_, indent) => {
    const text = `{\n${indent}"scripts": {\n${indent}${indent}"dev": "x"\n${indent}}\n}\n`;

    expect(setScripts(text, wanted)).toBe(
      `{\n${indent}"scripts": {\n${indent}${indent}"dev": "x",\n${indent}${indent}"gen:branding": "bun packages/config/scripts/gen-branding.ts"\n${indent}}\n}\n`,
    );
  });

  test("keeps CRLF line endings", () => {
    const text = PACKAGE.replaceAll("\n", "\r\n");

    const after = setScripts(text, wanted);

    expect(after.replaceAll("\r\n", "")).not.toContain("\n");
    expect(after).toContain('"build": "bun run build",\r\n    "gen:branding"');
  });

  test("creates `scripts` when the file has none", () => {
    const after = setScripts('{\n  "name": "demo"\n}\n', wanted);

    expect(JSON.parse(after)).toEqual({ name: "demo", scripts: wanted });
    expect(after).toStartWith('{\n  "name": "demo",\n  "scripts": {');
  });

  test("a second application changes nothing", () => {
    const once = setScripts(PACKAGE, wanted);

    expect(setScripts(once, wanted)).toBe(once);
  });

  test("writes several keys, replacing one that differs", () => {
    const text = '{\n  "scripts": {\n    "a": "old"\n  }\n}\n';

    const after = setScripts(text, { a: "new", b: "second" });

    expect(JSON.parse(after)).toEqual({ scripts: { a: "new", b: "second" } });
    expect(after).toBe('{\n  "scripts": {\n    "a": "new",\n    "b": "second"\n  }\n}\n');
  });

  test("an object written on one line gets the key on that line", () => {
    expect(setScripts('{ "scripts": { "a": "x" } }\n', { k: "v" })).toBe(
      '{ "scripts": { "a": "x", "k": "v" } }\n',
    );
  });

  test("an empty scripts object, or an empty file object, is filled on lines of their own", () => {
    expect(setScripts('{\n  "scripts": {\n  }\n}\n', { k: "v" })).toBe(
      '{\n  "scripts": {\n    "k": "v"\n  }\n}\n',
    );
    expect(setScripts("{}\n", { k: "v" })).toBe('{\n  "scripts": {\n    "k": "v"\n  }\n}\n');
  });

  test("a comment inside an empty scripts object stays", () => {
    const after = setScripts('{\n  "scripts": {\n    // none yet\n  }\n}\n', { k: "v" });

    expect(after).toContain("// none yet");
    expect(JSON.parse(after.replace("// none yet", ""))).toEqual({ scripts: { k: "v" } });
  });

  test("a script name with a dot or a colon is one key, not a path", () => {
    const after = setScripts('{ "scripts": {} }\n', { "build.prod": "x", "a:b": "y" });

    expect(JSON.parse(after)).toEqual({ scripts: { "build.prod": "x", "a:b": "y" } });
  });
});

describe("scripts.merge: inspectScripts", () => {
  test("tells an absent key, an equal one and a differing one apart", () => {
    const text = '{ "scripts": { "same": "x", "other": "y" } }\n';

    expect(inspectScripts(text, { same: "x", other: "z", added: "w" })).toEqual({
      ok: true,
      states: {
        same: { kind: "equal" },
        other: { kind: "differs", current: "y" },
        added: { kind: "absent" },
      },
    });
  });

  test("a script that is not a string differs, with no current text", () => {
    expect(inspectScripts('{ "scripts": { "a": 1 } }', { a: "x" })).toEqual({
      ok: true,
      states: { a: { kind: "differs", current: null } },
    });
  });

  test("every key is absent when the file has no scripts", () => {
    expect(inspectScripts('{ "name": "x" }', { a: "x" })).toEqual({
      ok: true,
      states: { a: { kind: "absent" } },
    });
  });

  test("a file that is not JSON cannot be patched, and says where it breaks", () => {
    const result = inspectScripts('{\n  "scripts": {\n    "a": \n}\n', { a: "x" });

    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/not valid JSON.*line 4/);
  });

  test("a file whose root is not an object, or whose scripts is not one, cannot be patched", () => {
    expect(inspectScripts("[]", { a: "x" })).toEqual({
      ok: false,
      reason: "the root is not a JSON object",
    });
    expect(inspectScripts('{ "scripts": "nope" }', { a: "x" })).toEqual({
      ok: false,
      reason: '"scripts" is a string, not an object',
    });
  });
});

describe("scripts.merge: readScripts and scriptRegion (what doctor reads)", () => {
  test("the region of a script is `scripts.<name>`", () => {
    expect(scriptRegion("gen:branding")).toBe("scripts.gen:branding");
  });

  test("reads the scripts object, and nothing when there is none", () => {
    expect(readScripts('{ "scripts": { "a": "x", "b": 2 } }')).toEqual({
      ok: true,
      scripts: { a: "x", b: 2 },
    });
    expect(readScripts('{ "name": "x" }')).toEqual({ ok: true, scripts: {} });
    expect(readScripts("nope").ok).toBe(false);
  });
});
