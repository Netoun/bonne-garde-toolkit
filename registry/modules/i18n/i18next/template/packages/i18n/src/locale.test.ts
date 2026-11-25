import { describe, expect, test } from "vite-plus/test";
import { LOCALE_COOKIE, parseLocaleCookie, resolveLocale, serializeLocaleCookie } from "./locale";

describe("parseLocaleCookie", () => {
  test("reads the locale out of a Cookie header", () => {
    expect(parseLocaleCookie("theme=dark; locale=fr; token=a=b")).toBe("fr");
  });

  test.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["no locale cookie", "theme=dark"],
    ["an unsupported language", "locale=de"],
    ["a BCP-47 tag, which is not a language key", "locale=fr-FR"],
    ["an inherited key", "locale=constructor"],
  ])("is null for %s", (_what, header) => {
    expect(parseLocaleCookie(header)).toBeNull();
  });

  test("keeps going on a value that is not valid percent-encoding", () => {
    expect(parseLocaleCookie("bad=%E0%A4%A; locale=en")).toBe("en");
  });
});

describe("serializeLocaleCookie", () => {
  test("is a year-long cookie for the whole site that parseLocaleCookie reads back", () => {
    const cookie = serializeLocaleCookie("fr");
    expect(cookie).toBe(`${LOCALE_COOKIE}=fr; Max-Age=31536000; Path=/; SameSite=Lax`);
    expect(parseLocaleCookie(cookie)).toBe("fr");
  });

  test("adds Secure when asked", () => {
    expect(serializeLocaleCookie("en", { secure: true }).endsWith("; Secure")).toBe(true);
  });
});

describe("resolveLocale", () => {
  test("the cookie wins over Accept-Language", () => {
    expect(resolveLocale({ cookie: "locale=fr", acceptLanguage: "en" })).toBe("fr");
  });

  test("Accept-Language is read with its q-values and regional tags", () => {
    expect(resolveLocale({ acceptLanguage: "fr-CA,fr;q=0.9,en;q=0.8" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "de;q=0.9,en;q=0.5,fr;q=0.7" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "en;q=0.4,fr" })).toBe("fr");
  });

  test("an unsupported cookie falls back to Accept-Language", () => {
    expect(resolveLocale({ cookie: "locale=de", acceptLanguage: "fr-FR" })).toBe("fr");
  });

  test("a language the visitor refuses (q=0) is not picked", () => {
    expect(resolveLocale({ acceptLanguage: "fr;q=0,en;q=0.1" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "fr;q=0" })).toBe("en");
  });

  test.each([
    ["nothing", {}],
    ["null headers", { cookie: null, acceptLanguage: null }],
    ["only unsupported languages", { acceptLanguage: "de-DE,de;q=0.9,*;q=0.1" }],
  ])("gives the default for %s", (_what, input) => {
    expect(resolveLocale(input)).toBe("en");
  });
});
