import { Elysia } from "elysia";
import { resolveLocale } from "./locale";

/**
 * The Elysia plugin that gives every route of the app the language of its request, as `locale`:
 * the `locale` cookie, then `Accept-Language`, then the default language. It only resolves it: no
 * API route has text to translate yet.
 */
export const i18nModule = new Elysia({ name: "i18n" }).derive({ as: "global" }, ({ headers }) => ({
  locale: resolveLocale({ cookie: headers.cookie, acceptLanguage: headers["accept-language"] }),
}));
