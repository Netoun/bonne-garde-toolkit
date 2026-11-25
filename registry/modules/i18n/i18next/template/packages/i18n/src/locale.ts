import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  matchLanguageTag,
  type SupportedLocale,
} from "./config";

/** The cookie that carries the language between the browser, the API and the server render. */
export const LOCALE_COOKIE = "locale";

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

/** The language a `Cookie` header carries, if it is a supported key: `fr-FR` is not one. */
export function parseLocaleCookie(header: string | null | undefined): SupportedLocale | null {
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1 || pair.slice(0, separator).trim() !== LOCALE_COOKIE) {
      continue;
    }
    const value = decode(pair.slice(separator + 1).trim());
    return isSupportedLocale(value) ? value : null;
  }
  return null;
}

/** The `Set-Cookie` value (or `document.cookie` assignment) that stores a language for a year. */
export function serializeLocaleCookie(
  locale: SupportedLocale,
  options: { secure?: boolean } = {},
): string {
  const parts = [
    `${LOCALE_COOKIE}=${locale}`,
    `Max-Age=${ONE_YEAR_IN_SECONDS}`,
    "Path=/",
    "SameSite=Lax",
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/** The language of a request: its cookie, then its `Accept-Language`, then the default. */
export function resolveLocale(request: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): SupportedLocale {
  return (
    parseLocaleCookie(request.cookie) ??
    parseAcceptLanguage(request.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

/** The first supported language by descending q-value; a q of 0 is a refusal, `*` matches nothing. */
function parseAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
  const ranges = (header ?? "").split(",").flatMap((range, position) => {
    const [tag = "", ...params] = range.split(";");
    const quality = params
      .map((param) => /^\s*q\s*=\s*(\d(?:\.\d{0,3})?)\s*$/i.exec(param)?.[1])
      .find((value) => value !== undefined);
    const q = quality === undefined ? 1 : Number(quality);
    const locale = matchLanguageTag(tag.trim());
    return locale !== null && q > 0 ? [{ locale, q, position }] : [];
  });
  ranges.sort((a, b) => b.q - a.q || a.position - b.position);
  return ranges[0]?.locale ?? null;
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
