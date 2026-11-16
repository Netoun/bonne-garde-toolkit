import { describe, expect, test } from "bun:test";
import { formatWithProjectFormatter } from "../test-support/project-formatter";
import { byName, setDependencies, type DependencyEntry } from "./package-dependencies";

/**
 * 060: `package.dependencies` writes each entry where the project's formatter sorts it. Every case
 * patches a package.json the way a module will and hands the result to `vp fmt` with the config
 * `tooling/vite-plus` installs; the formatter must give it back unchanged, or `bun run check` fails
 * right after `bg add` and fixing it by hand makes `doctor` report the file as edited.
 */

const dep = (name: string, version = "1.0.0"): DependencyEntry => ({
  map: "dependencies",
  name,
  version,
});
const dev = (name: string, version = "1.0.0"): DependencyEntry => ({
  map: "devDependencies",
  name,
  version,
});

const pkg = (body: Record<string, unknown>) => `${JSON.stringify(body, null, 2)}\n`;

/** Patches each case, and expects the formatter to leave every patched file as it is. */
async function expectStable(
  cases: Record<string, { text: string; entries: DependencyEntry[] }>,
): Promise<Record<string, string>> {
  const patched = Object.fromEntries(
    Object.entries(cases).map(([name, { text, entries }]) => [
      `${name}/package.json`,
      setDependencies(text, entries),
    ]),
  );
  // The input is what the formatter writes too, or a difference below could not be told from one of its own.
  const inputs = Object.fromEntries(
    Object.entries(cases).map(([name, { text }]) => [`${name}/package.json`, text]),
  );
  expect(await formatWithProjectFormatter(inputs)).toEqual(inputs);
  expect(await formatWithProjectFormatter(patched)).toEqual(patched);
  return patched;
}

describe("package.dependencies writes what the formatter writes (060)", () => {
  const withMap = pkg({
    name: "demo",
    type: "module",
    scripts: { dev: "bun run dev" },
    dependencies: { b: "2.0.0", d: "4.0.0", f: "6.0.0" },
    devDependencies: { typescript: "7.0.2" },
  });

  test("into an empty map, at the start, in the middle and at the end of a map", async () => {
    const empty = pkg({ name: "demo", dependencies: {} });

    await expectStable({
      "empty-map": { text: empty, entries: [dep("a")] },
      "empty-devdeps": {
        text: pkg({ name: "demo", devDependencies: {} }),
        entries: [dev("typescript", "7.0.2")],
      },
      start: { text: withMap, entries: [dep("a")] },
      middle: { text: withMap, entries: [dep("c"), dep("e")] },
      end: { text: withMap, entries: [dep("g")] },
      "dev-start": { text: withMap, entries: [dev("@types/bun", "1.3.0")] },
      "dev-end": { text: withMap, entries: [dev("vitest", "4.0.0")] },
      several: { text: withMap, entries: [dep("g"), dep("a"), dep("c"), dev("a-dev")] },
    });
  });

  test("into a `dependencies` or a `devDependencies` the file does not have, and into both", async () => {
    const scripts = { dev: "bun run dev", test: "bun test" };
    await expectStable({
      "no-deps": {
        text: pkg({ name: "demo", scripts, devDependencies: { typescript: "7.0.2" } }),
        entries: [dep("@app/db", "workspace:*")],
      },
      "no-devdeps": {
        text: pkg({ name: "demo", scripts, dependencies: { a: "1.0.0" } }),
        entries: [dev("typescript", "7.0.2")],
      },
      "no-maps": {
        text: pkg({ name: "demo", version: "0.0.1", private: true, type: "module", scripts }),
        entries: [dev("typescript", "7.0.2"), dep("elysia", "1.4.29")],
      },
      "no-maps-no-scripts": {
        text: pkg({ name: "demo", type: "module", exports: { ".": "./src/index.ts" } }),
        entries: [dep("a"), dev("b")],
      },
      "before-peers": {
        text: pkg({
          name: "demo",
          scripts,
          peerDependencies: { react: "19.0.0" },
          engines: { bun: ">=1.3" },
          packageManager: "bun@1.4.2",
          zzz: true,
        }),
        entries: [dev("typescript", "7.0.2"), dep("a")],
      },
      "only-name": { text: pkg({ name: "demo" }), entries: [dep("a"), dev("b")] },
      "empty-root": { text: "{}\n", entries: [dep("a"), dev("b")] },
    });
  });

  test("a scoped name, and a name with a dot, a dash or capitals in it", async () => {
    const text = pkg({
      name: "demo",
      dependencies: { "@a-b/c": "1.0.0", lodash: "1.0.0", zod: "4.0.0" },
    });

    const patched = await expectStable({
      scoped: { text, entries: [dep("@a/z"), dep("@types/bun"), dep("@x/y", "workspace:*")] },
      dotted: { text, entries: [dep("lodash.merge"), dep("lodash-es"), dep("Zeta"), dep("_x")] },
    });

    expect(Object.keys(patched)).toEqual(["scoped/package.json", "dotted/package.json"]);
  });

  test("the entry of a sibling package moves with the scope: before `@elysiajs/*` for `@app`, after for `@zz`", async () => {
    const api = (scope: string) =>
      pkg({
        name: `${scope}/api`,
        version: "0.0.1",
        private: true,
        type: "module",
        scripts: { test: "bun test" },
        // As the formatter keeps it: the scope decides where its two entries sort.
        dependencies: Object.fromEntries(
          Object.entries({
            "@elysiajs/cors": "1.4.2",
            "@elysiajs/eden": "1.4.9",
            [`${scope}/api-runtime`]: "workspace:*",
            [`${scope}/config`]: "workspace:*",
            elysia: "1.4.29",
          }).sort(([a], [b]) => byName(a, b)),
        ),
      });

    const patched = await expectStable(
      Object.fromEntries(
        ["@app", "@elysiajs-x", "@zz", "@acme-a-rather-long-scope"].map((scope) => [
          `scope-${scope.slice(1)}`,
          { text: api(scope), entries: [dep(`${scope}/db`, "workspace:*")] },
        ]),
      ),
    );

    const orderOf = (scope: string): string[] =>
      Object.keys(
        (
          JSON.parse(patched[`scope-${scope.slice(1)}/package.json`] ?? "{}") as {
            dependencies: object;
          }
        ).dependencies,
      );
    // The scope sorts `@app/*` before `@elysiajs/*` and `@zz/*` after it: the insertion follows.
    expect(orderOf("@app").indexOf("@app/db")).toBeLessThan(
      orderOf("@app").indexOf("@elysiajs/cors"),
    );
    expect(orderOf("@zz").indexOf("@zz/db")).toBeGreaterThan(
      orderOf("@zz").indexOf("@elysiajs/eden"),
    );
  });
});

describe("the keys the formatter puts before `dependencies`", () => {
  // Every top-level key vite-plus 0.2.8's `sortPackageJson` knows, plus one it does not. A key it
  // moves from one side of `dependencies` to the other fails the test below, naming the formatter's
  // order, which is where `BEFORE_DEPENDENCIES` has to follow it.
  const KNOWN =
    `$schema name displayName version stableVersion private description categories keywords homepage bugs license author maintainers contributors repository funding qna publisher man style example examplestyle assets bin source directories workspaces binary files os cpu type sideEffects main module browser types typings typesVersions react-native svelte unpkg jsdelivr jsnext:main umd:main imports exports publishConfig scripts betterScripts wireit dependenciesMeta peerDependencies peerDependenciesMeta optionalDependencies bundledDependencies bundleDependencies resolutions overrides husky simple-git-hooks lint-staged nano-staged pre-commit commitlint l10n contributes activationEvents extensionPack extensionDependencies icon badges galleryBanner preview markdown flat config nodemonConfig browserify babel browserslist xo prettier eslintConfig eslintIgnore npmpkgjsonlint npmPackageJsonLintConfig npmpackagejsonlint release remarkConfig stylelint ava jest jest-junit jest-stare mocha nyc c8 tap oclif languageName preferGlobal devEngines engines engineStrict volta packageManager pnpm aaa-unknown`.split(
      " ",
    );

  test("a map added to a file that has every one of them lands where the formatter keeps it", async () => {
    // Backwards, so that the formatter's order is the only order there is.
    const shuffled = Object.fromEntries([...KNOWN].reverse().map((key) => [key, "x"]));
    const files = await formatWithProjectFormatter({ "package.json": pkg(shuffled) });
    const sorted = files["package.json"] ?? "";
    expect(Object.keys(JSON.parse(sorted) as object)).not.toEqual([...KNOWN].reverse());

    const patched = setDependencies(sorted, [dev("typescript", "7.0.2"), dep("a")]);

    expect(await formatWithProjectFormatter({ "package.json": patched })).toEqual({
      "package.json": patched,
    });
    const keys = Object.keys(JSON.parse(patched) as object);
    expect(keys.indexOf("dependencies")).toBe(keys.indexOf("devDependencies") - 1);
  });
});
