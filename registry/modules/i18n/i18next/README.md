# i18n/i18next

The project's languages in `packages/i18n`: which ones it speaks, which one a request wants, and how an app's locale
files become i18next resources. It is the pure core of `lonestone-boilerplate/packages/i18n`, plus the Elysia plugin that
gives the API the language of a request; the language store and the app wiring come on top of it.

```bash
bunx bonne-garde add i18n/i18next
```

## Peers and variants

| Peer       | Allow-list | Why                                                                         |
| ---------- | ---------- | --------------------------------------------------------------------------- |
| `provider` | any        | Plain TypeScript: no Cloudflare API, so one variant serves both providers   |
| `api`      | optional   | With `api/elysia` installed, the `api` variant mounts the plugin on the API |

Two variants, no intention:

- `default`: the package alone.
- `api` (`match: { api: "elysia" }`): the default's files plus `src/elysia.ts` and its test, the `./elysia` export,
  `elysia`, and three patches on `apps/api`: the `{{SCOPE}}/i18n` dependency, the import and `.use(i18nModule)`.
  Installing `api/elysia` after `i18n/i18next` selects it again (`add` reports the variant left and the one taken).

## What it writes

Everything in `packages/i18n`:

| File               | What it is                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `package.json`     | `{{SCOPE}}/i18n`: the `.` export and the scripts                                                                 |
| `src/config.ts`    | `SUPPORTED_LOCALES` (`en`, `fr`), `DEFAULT_LOCALE` (`en`), `isSupportedLocale`, `normalizeLocale`, `getHtmlLang` |
| `src/locale.ts`    | `LOCALE_COOKIE`, `parseLocaleCookie`, `serializeLocaleCookie` and `resolveLocale`                                |
| `src/resources.ts` | `toResources`: a glob of `locales/<language>/<namespace>.json` files to an i18next `Resource`                    |
| `src/elysia.ts`    | `api` variant only: `i18nModule`, the Elysia plugin                                                              |
| `src/*.test.ts`    | Vitest tests of the above                                                                                        |

## Languages

A language is its key (`en`, `fr`) in i18next, in the `locale` cookie and everywhere else. The BCP-47 tag
(`en-GB`, `fr-FR`) exists only as `getHtmlLang(locale)`, for `<html lang>` and `Intl`: never give it to i18next.
`en` is the default and the fallback for a missing key.

## Resolving the language of a request

```ts
import { resolveLocale } from "{{SCOPE}}/i18n";

resolveLocale({
  cookie: request.headers.get("cookie"),
  acceptLanguage: request.headers.get("accept-language"),
});
```

1. The `locale` cookie, when it is a supported key (`fr`; `fr-FR` is not one).
2. `Accept-Language`, by descending q-value, regional tags matching their language (`fr-CA` is `fr`); `q=0` refuses a
   language and `*` matches nothing.
3. `en`.

`serializeLocaleCookie("fr")` gives the cookie that stores the choice for a year, for the whole site.

## Loading an app's locale files

An app keeps its text in `src/locales/<language>/<namespace>.json`, and turns it into resources where Vite can see the glob:

```ts
import { toResources } from "{{SCOPE}}/i18n";

const resources = toResources(
  import.meta.glob("./locales/*/*.json", { eager: true, import: "default" }),
);
```

## In the API

With the `api` variant, `apps/api` mounts `i18nModule` and every route (of the app and of its nested plugins) reads the
request's language as `locale`, resolved by the rule above from the `cookie` and `accept-language` headers:

```ts
new Elysia().use(i18nModule).get("/me/greeting", ({ locale }) => ({ locale })); // "fr" for Cookie: locale=fr
```

It only resolves the language: no API module has text to translate, so there is no server-side `t` yet. Code that has
a request elsewhere (an email job, a webhook) calls `resolveLocale` itself. The plugin is imported from
`{{SCOPE}}/i18n/elysia`, so an app that has no API never pulls `elysia` through `{{SCOPE}}/i18n`.
