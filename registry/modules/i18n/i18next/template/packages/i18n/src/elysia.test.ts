import { describe, expect, it } from "vite-plus/test";
import { Elysia } from "elysia";
import { i18nModule } from "./elysia";

/**
 * The app mounts the plugin, as `apps/api` does, and a route reads `locale`. The nested plugin never
 * imports the module, so it reads `locale` from the context by name: it only sees it if the derive is global.
 */
const app = new Elysia()
  .use(i18nModule)
  .get("/locale", ({ locale }) => ({ locale }))
  .use(new Elysia().get("/nested", (context) => ({ locale: Reflect.get(context, "locale") })));

async function localeOf(path: string, headers: Record<string, string> = {}) {
  const res = await app.handle(new Request(`http://localhost${path}`, { headers }));
  return res.json();
}

describe("i18nModule", () => {
  it("answers the locale cookie", async () => {
    expect(await localeOf("/locale", { cookie: "locale=fr" })).toEqual({ locale: "fr" });
  });

  it("answers the Accept-Language language", async () => {
    expect(await localeOf("/locale", { "accept-language": "fr-FR" })).toEqual({ locale: "fr" });
  });

  it("prefers the cookie to Accept-Language", async () => {
    expect(await localeOf("/locale", { cookie: "locale=en", "accept-language": "fr" })).toEqual({
      locale: "en",
    });
  });

  it("answers the default language without a header", async () => {
    expect(await localeOf("/locale")).toEqual({ locale: "en" });
  });

  it("is global: a route of a nested plugin sees it", async () => {
    expect(await localeOf("/nested", { cookie: "locale=fr" })).toEqual({ locale: "fr" });
  });
});
