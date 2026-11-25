/**
 * The languages of the project. A language is identified by its key (`en`, `fr`) everywhere: i18next,
 * the `locale` cookie, the store. The BCP-47 tag is only for `<html lang>` and `Intl`: never hand it
 * to i18next.
 *
 * To add a language: add its key here, then its `locales/<key>/` files in each app.
 */
export const SUPPORTED_LOCALES = {
  en: { name: "English", htmlLang: "en-GB" },
  fr: { name: "Français", htmlLang: "fr-FR" },
} as const;

export type SupportedLocale = keyof typeof SUPPORTED_LOCALES;

/** The language when nothing says otherwise, and the one i18next falls back to for a missing key. */
export const DEFAULT_LOCALE: SupportedLocale = "en";

export function isSupportedLocale(value: string): value is SupportedLocale {
  return Object.hasOwn(SUPPORTED_LOCALES, value);
}

/** `fr`, `fr-FR` and `FR-ca` give `fr`; anything unsupported or empty gives the default. */
export function normalizeLocale(tag: string | null | undefined): SupportedLocale {
  return (tag ? matchLanguageTag(tag) : null) ?? DEFAULT_LOCALE;
}

/** The BCP-47 tag for `<html lang>`: `fr` gives `fr-FR`. */
export function getHtmlLang(locale: SupportedLocale): string {
  return SUPPORTED_LOCALES[locale].htmlLang;
}

/** The supported language a tag (`fr-CA`) belongs to, or null. */
export function matchLanguageTag(tag: string): SupportedLocale | null {
  const language = tag.split("-")[0]?.trim().toLowerCase() ?? "";
  return isSupportedLocale(language) ? language : null;
}
