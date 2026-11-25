import { describe, expect, test } from "vite-plus/test";
import {
  DEFAULT_LOCALE,
  getHtmlLang,
  isSupportedLocale,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "./config";

describe("SUPPORTED_LOCALES", () => {
  test("holds English and French, English being the default", () => {
    expect(Object.keys(SUPPORTED_LOCALES)).toEqual(["en", "fr"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });
});

describe("isSupportedLocale", () => {
  test("accepts the language keys and nothing else", () => {
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("fr")).toBe(true);
    expect(isSupportedLocale("fr-FR")).toBe(false);
    expect(isSupportedLocale("de")).toBe(false);
  });

  test("ignores the keys every object inherits", () => {
    expect(isSupportedLocale("constructor")).toBe(false);
    expect(isSupportedLocale("toString")).toBe(false);
  });
});

describe("normalizeLocale", () => {
  test("keeps a supported key", () => {
    expect(normalizeLocale("fr")).toBe("fr");
  });

  test("maps a BCP-47 tag to its language key, whatever its case", () => {
    expect(normalizeLocale("fr-FR")).toBe("fr");
    expect(normalizeLocale("EN-gb")).toBe("en");
  });

  test.each([[undefined], [null], [""], ["de"], ["toString"]])(
    "falls back to the default for %p",
    (tag) => {
      expect(normalizeLocale(tag)).toBe(DEFAULT_LOCALE);
    },
  );
});

describe("getHtmlLang", () => {
  test("gives the BCP-47 tag for <html lang>, never a language key", () => {
    expect(getHtmlLang("en")).toBe("en-GB");
    expect(getHtmlLang("fr")).toBe("fr-FR");
  });
});
