import { describe, it, expect } from "bun:test";
import { config } from "@acme/api/lib/app.config";
import { createAuth } from "./auth.config";

describe("createAuth security defaults", () => {
  it("keeps origin and CSRF protection on, also under NODE_ENV=test", async () => {
    const context = await createAuth().$context;

    expect(context.skipOriginCheck).toBe(false);
    expect(context.skipCSRFCheck).toBe(false);
  });

  it("issues httpOnly, lax session cookies, Secure only over https", async () => {
    const context = await createAuth().$context;

    expect(context.authCookies.sessionToken.attributes).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: config.API_URL.startsWith("https://"),
    });
  });
});
