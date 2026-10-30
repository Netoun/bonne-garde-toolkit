import { describe, expect, test } from "bun:test";
import { dependencyEntries, setDependencies } from "./package-dependencies";

/**
 * `package.dependencies` (060): each entry goes where the project's formatter sorts it, and every
 * other byte of the file stays. These are the bytes; `package-dependencies-format.test.ts` hands the
 * same results to `vp fmt`.
 */

const PACKAGE = `{
  "name": "demo",
  "scripts": {
    "dev": "bun run dev"
  },
  "dependencies": {
    "b": "2.0.0",
    "d": "4.0.0",
    "f": "6.0.0"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
`;

const dep = (name: string, version = "1.0.0") => ({
  map: "dependencies" as const,
  name,
  version,
});
const dev = (name: string, version = "1.0.0") => ({
  map: "devDependencies" as const,
  name,
  version,
});

describe("dependencyEntries: the regions' names and values, dependencies first", () => {
  test("lists dependencies, then devDependencies, each in the order declared", () => {
    expect(
      dependencyEntries({
        dependencies: { zod: "4.0.0", "@app/db": "workspace:*" },
        devDependencies: { vitest: "4.0.0" },
      }),
    ).toEqual([
      { map: "dependencies", name: "zod", version: "4.0.0" },
      { map: "dependencies", name: "@app/db", version: "workspace:*" },
      { map: "devDependencies", name: "vitest", version: "4.0.0" },
    ]);
  });
});

describe("setDependencies: an entry goes where a sorted map has it (060)", () => {
  test("before the first name that sorts after it, in the middle of the map", () => {
    expect(setDependencies(PACKAGE, [dep("c", "3.0.0")])).toBe(
      PACKAGE.replace('    "d": "4.0.0"', '    "c": "3.0.0",\n    "d": "4.0.0"'),
    );
  });

  test("at the start of the map", () => {
    expect(setDependencies(PACKAGE, [dep("a", "1.0.0")])).toBe(
      PACKAGE.replace('    "b": "2.0.0"', '    "a": "1.0.0",\n    "b": "2.0.0"'),
    );
  });

  test("at the end of the map", () => {
    expect(setDependencies(PACKAGE, [dep("g", "7.0.0")])).toBe(
      PACKAGE.replace('    "f": "6.0.0"\n', '    "f": "6.0.0",\n    "g": "7.0.0"\n'),
    );
  });

  test("into an empty map, on lines of its own", () => {
    const text = '{\n  "name": "demo",\n  "dependencies": {}\n}\n';

    expect(setDependencies(text, [dep("a")])).toBe(
      '{\n  "name": "demo",\n  "dependencies": {\n    "a": "1.0.0"\n  }\n}\n',
    );
  });

  test("a scoped name sorts by its characters: `@` before every letter, `-` before `/`", () => {
    const text = '{\n  "dependencies": {\n    "@a-b/c": "1.0.0",\n    "zod": "4.0.0"\n  }\n}\n';

    const after = setDependencies(text, [dep("@a/z"), dep("@types/bun")]);

    expect(after).toBe(
      '{\n  "dependencies": {\n    "@a-b/c": "1.0.0",\n    "@a/z": "1.0.0",\n    "@types/bun": "1.0.0",\n    "zod": "4.0.0"\n  }\n}\n',
    );
  });

  test("a name with a dot sorts after the one with a dash, and an uppercase one before a lowercase", () => {
    const text = '{\n  "dependencies": {\n    "lodash": "1.0.0"\n  }\n}\n';

    const after = setDependencies(text, [dep("lodash.merge"), dep("lodash-es"), dep("Zeta")]);

    expect(Object.keys((JSON.parse(after) as { dependencies: object }).dependencies)).toEqual([
      "Zeta",
      "lodash",
      "lodash-es",
      "lodash.merge",
    ]);
  });

  test("several entries land in order whatever order they are given in", () => {
    const after = setDependencies(PACKAGE, [dep("g"), dep("a"), dep("c"), dep("e")]);

    expect(Object.keys((JSON.parse(after) as { dependencies: object }).dependencies)).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });

  test("devDependencies are a map of their own", () => {
    expect(setDependencies(PACKAGE, [dev("@types/bun", "1.3.0")])).toBe(
      PACKAGE.replace(
        '    "typescript": "7.0.2"',
        '    "@types/bun": "1.3.0",\n    "typescript": "7.0.2"',
      ),
    );
  });

  test("leaves comments, unusual spacing and a trailing comma where they are", () => {
    const text = `// my app
{
  "name":   "demo", /* keep */
  "dependencies": {
    "b":"2.0.0", // two
    "d": "4.0.0",
  },
}
`;

    const after = setDependencies(text, [dep("c"), dep("e")]);

    expect(after).toBe(`// my app
{
  "name":   "demo", /* keep */
  "dependencies": {
    "b":"2.0.0", // two
    "c": "1.0.0",
    "d": "4.0.0",
    "e": "1.0.0",
  },
}
`);
  });

  test.each([
    ["two spaces", "  "],
    ["four spaces", "    "],
    ["tabs", "\t"],
  ])("indents like the file does: %s", (_, unit) => {
    const text = `{\n${unit}"dependencies": {\n${unit}${unit}"b": "2.0.0"\n${unit}}\n}\n`;

    expect(setDependencies(text, [dep("a"), dep("c")])).toBe(
      `{\n${unit}"dependencies": {\n${unit}${unit}"a": "1.0.0",\n${unit}${unit}"b": "2.0.0",\n${unit}${unit}"c": "1.0.0"\n${unit}}\n}\n`,
    );
  });

  test("keeps CRLF line endings", () => {
    const text = PACKAGE.replaceAll("\n", "\r\n");

    const after = setDependencies(text, [dep("a"), dep("c"), dep("g")]);

    expect(after).toBe(
      PACKAGE.replace('    "b": "2.0.0"', '    "a": "1.0.0",\n    "b": "2.0.0"')
        .replace('    "d": "4.0.0"', '    "c": "1.0.0",\n    "d": "4.0.0"')
        .replace('    "f": "6.0.0"\n', '    "f": "6.0.0",\n    "g": "1.0.0"\n')
        .replaceAll("\n", "\r\n"),
    );
  });

  test("a map on one line gets the entry on that line", () => {
    const text = '{ "name": "demo", "dependencies": { "b": "2.0.0", "d": "4.0.0" } }\n';

    expect(setDependencies(text, [dep("a"), dep("c"), dep("e")])).toBe(
      '{ "name": "demo", "dependencies": { "a": "1.0.0", "b": "2.0.0", "c": "1.0.0", "d": "4.0.0", "e": "1.0.0" } }\n',
    );
  });

  test("an entry that is there with another version has its version replaced, nothing else", () => {
    expect(setDependencies(PACKAGE, [dep("d", "4.1.0")])).toBe(PACKAGE.replace("4.0.0", "4.1.0"));
  });

  test("is idempotent on what it wrote", () => {
    const once = setDependencies(PACKAGE, [dep("c"), dev("vitest")]);

    expect(setDependencies(once, [dep("c"), dev("vitest")])).toBe(once);
  });

  test("a map that is not an object cannot hold an entry", () => {
    expect(() => setDependencies('{\n  "dependencies": ["a"]\n}\n', [dep("a")])).toThrow(
      /"dependencies" is not an object/,
    );
  });
});

describe("setDependencies: a map the file does not have is added where the formatter puts it (060)", () => {
  test("`dependencies` goes after `scripts`, before `devDependencies`", () => {
    const text = `{
  "name": "demo",
  "scripts": {
    "dev": "bun run dev"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
`;

    expect(setDependencies(text, [dep("@app/db", "workspace:*")])).toBe(`{
  "name": "demo",
  "scripts": {
    "dev": "bun run dev"
  },
  "dependencies": {
    "@app/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
`);
  });

  test("`devDependencies` goes after `dependencies` and before `peerDependencies` and a key the formatter does not know", () => {
    const text = `{
  "name": "demo",
  "dependencies": {
    "a": "1.0.0"
  },
  "peerDependencies": {
    "react": "19.0.0"
  },
  "zzz": true
}
`;

    expect(setDependencies(text, [dev("typescript", "7.0.2")])).toBe(`{
  "name": "demo",
  "dependencies": {
    "a": "1.0.0"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  },
  "peerDependencies": {
    "react": "19.0.0"
  },
  "zzz": true
}
`);
  });

  test("at the end of a file that has nothing after where the map goes", () => {
    const text = '{\n  "name": "demo",\n  "type": "module"\n}\n';

    expect(setDependencies(text, [dep("a")])).toBe(
      '{\n  "name": "demo",\n  "type": "module",\n  "dependencies": {\n    "a": "1.0.0"\n  }\n}\n',
    );
  });

  test("both maps in one call, in the order the formatter keeps them", () => {
    const text = '{\n  "name": "demo",\n  "scripts": {\n    "dev": "x"\n  }\n}\n';

    const after = setDependencies(text, [
      dev("typescript", "7.0.2"),
      dep("@app/db", "workspace:*"),
    ]);

    expect(Object.keys(JSON.parse(after) as object)).toEqual([
      "name",
      "scripts",
      "dependencies",
      "devDependencies",
    ]);
    expect(after).toContain('  "dependencies": {\n    "@app/db": "workspace:*"\n  },\n');
  });

  test("before a key the formatter does not know, which it keeps last", () => {
    const text = '{\n  "name": "demo",\n  "custom": 1\n}\n';

    expect(Object.keys(JSON.parse(setDependencies(text, [dep("a")])) as object)).toEqual([
      "name",
      "dependencies",
      "custom",
    ]);
  });

  test("into a file whose root is empty", () => {
    expect(setDependencies("{}\n", [dep("a")])).toBe(
      '{\n  "dependencies": {\n    "a": "1.0.0"\n  }\n}\n',
    );
  });

  test("a map on one line gets the new map on that line", () => {
    expect(setDependencies('{ "name": "demo", "type": "module" }\n', [dep("a")])).toBe(
      '{ "name": "demo", "type": "module", "dependencies": { "a": "1.0.0" } }\n',
    );
  });

  test("a file that is not a JSON object cannot hold one", () => {
    expect(() => setDependencies("[]\n", [dep("a")])).toThrow(/the root is not a JSON object/);
  });
});
