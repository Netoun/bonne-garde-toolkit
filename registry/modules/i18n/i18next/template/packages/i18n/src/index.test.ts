import { describe, expect, test } from "vite-plus/test";
import * as i18n from "./index";

describe("the package's public surface", () => {
  test("exports what an app and the API read", () => {
    expect(Object.keys(i18n).toSorted()).toEqual([
      "DEFAULT_LOCALE",
      "LOCALE_COOKIE",
      "SUPPORTED_LOCALES",
      "getHtmlLang",
      "isSupportedLocale",
      "normalizeLocale",
      "parseLocaleCookie",
      "resolveLocale",
      "serializeLocaleCookie",
      "toResources",
    ]);
  });
});
