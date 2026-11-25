import { describe, expect, test } from "vite-plus/test";
import { toResources } from "./resources";

describe("toResources", () => {
  test("groups a glob of locales/<lang>/<namespace>.json by language, then namespace", () => {
    expect(
      toResources({
        "./locales/en/common.json": { hello: "Hello" },
        "./locales/fr/common.json": { hello: "Bonjour" },
        "./locales/en/auth.json": { title: "Sign in" },
      }),
    ).toEqual({
      en: { common: { hello: "Hello" }, auth: { title: "Sign in" } },
      fr: { common: { hello: "Bonjour" } },
    });
  });

  test("reads the same shape under any prefix and on Windows separators", () => {
    expect(
      toResources({
        "/src/locales/fr/common.json": { a: "1" },
        "C:\\app\\src\\locales\\en\\common.json": { a: "2" },
      }),
    ).toEqual({ fr: { common: { a: "1" } }, en: { common: { a: "2" } } });
  });

  test("skips a path that is not a locale file and a module that is not an object", () => {
    expect(
      toResources({
        "./locales/en/notes.txt": { a: "1" },
        "./other/en/common.json": { a: "1" },
        "./locales/en/common.json": "not an object",
        "./locales/fr/common.json": { a: "1" },
      }),
    ).toEqual({ fr: { common: { a: "1" } } });
  });

  test("is empty for an empty glob", () => {
    expect(toResources({})).toEqual({});
  });
});
