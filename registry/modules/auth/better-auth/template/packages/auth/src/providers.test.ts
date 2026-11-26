import { describe, expect, it } from "vite-plus/test";
import { readProviders } from "./providers";

describe("readProviders", () => {
  it("rends no provider for an empty environment", () => {
    expect(readProviders({})).toEqual([]);
  });

  it("activates a social provider that has both keys, with sign-up off", () => {
    expect(readProviders({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })).toEqual([
      {
        id: "google",
        kind: "social",
        label: "Google",
        autoSignup: false,
        options: { clientId: "id", clientSecret: "secret" },
      },
    ]);
  });

  it("reads <ID>_AUTO_SIGNUP, and refuses any value but true or false, naming the key", () => {
    const keys = { GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret" };
    expect(readProviders({ ...keys, GITHUB_AUTO_SIGNUP: "true" })[0]?.autoSignup).toBe(true);
    expect(readProviders({ ...keys, GITHUB_AUTO_SIGNUP: "false" })[0]?.autoSignup).toBe(false);
    expect(() => readProviders({ ...keys, GITHUB_AUTO_SIGNUP: "yes" })).toThrow(
      "GITHUB_AUTO_SIGNUP",
    );
  });

  it("names the missing key when a social provider has only one of its two", () => {
    expect(() => readProviders({ GOOGLE_CLIENT_ID: "id" })).toThrow("GOOGLE_CLIENT_SECRET");
    expect(() => readProviders({ GOOGLE_CLIENT_SECRET: "secret" })).toThrow("GOOGLE_CLIENT_ID");
    expect(() => readProviders({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "  " })).toThrow(
      "GOOGLE_CLIENT_SECRET",
    );
  });

  it("knows github, gitlab, discord, google and microsoft, in that order", () => {
    const env: Record<string, string> = {};
    for (const id of ["MICROSOFT", "GOOGLE", "DISCORD", "GITLAB", "GITHUB"]) {
      env[`${id}_CLIENT_ID`] = "id";
      env[`${id}_CLIENT_SECRET`] = "secret";
    }
    expect(readProviders(env).map(({ id, label }) => [id, label])).toEqual([
      ["github", "GitHub"],
      ["gitlab", "GitLab"],
      ["discord", "Discord"],
      ["google", "Google"],
      ["microsoft", "Microsoft"],
    ]);
  });

  it("reads an OIDC provider from OIDC_PROVIDERS, with its label and sign-up", () => {
    expect(
      readProviders({
        OIDC_PROVIDERS: "corp, my-idp",
        OIDC_CORP_ISSUER: "https://sso.corp.test",
        OIDC_CORP_CLIENT_ID: "corp-id",
        OIDC_CORP_CLIENT_SECRET: "corp-secret",
        OIDC_CORP_NAME: "Corp SSO",
        OIDC_CORP_AUTO_SIGNUP: "true",
        OIDC_MY_IDP_ISSUER: "https://idp.test",
        OIDC_MY_IDP_CLIENT_ID: "idp-id",
        OIDC_MY_IDP_CLIENT_SECRET: "idp-secret",
      }),
    ).toEqual([
      {
        id: "corp",
        kind: "oidc",
        label: "Corp SSO",
        autoSignup: true,
        options: {
          issuer: "https://sso.corp.test",
          clientId: "corp-id",
          clientSecret: "corp-secret",
        },
      },
      {
        id: "my-idp",
        kind: "oidc",
        label: "my-idp",
        autoSignup: false,
        options: { issuer: "https://idp.test", clientId: "idp-id", clientSecret: "idp-secret" },
      },
    ]);
  });

  it("lists the social providers before the OIDC ones", () => {
    const providers = readProviders({
      OIDC_PROVIDERS: "corp",
      OIDC_CORP_ISSUER: "https://sso.corp.test",
      OIDC_CORP_CLIENT_ID: "a",
      OIDC_CORP_CLIENT_SECRET: "b",
      GOOGLE_CLIENT_ID: "c",
      GOOGLE_CLIENT_SECRET: "d",
    });
    expect(providers.map(({ id }) => id)).toEqual(["google", "corp"]);
  });

  it("names each missing key of an OIDC provider", () => {
    const full = {
      OIDC_PROVIDERS: "corp",
      OIDC_CORP_ISSUER: "https://sso.corp.test",
      OIDC_CORP_CLIENT_ID: "a",
      OIDC_CORP_CLIENT_SECRET: "b",
    };
    for (const key of ["ISSUER", "CLIENT_ID", "CLIENT_SECRET"]) {
      const { [`OIDC_CORP_${key}`]: _removed, ...env } = full as Record<string, string>;
      expect(() => readProviders(env)).toThrow(`OIDC_CORP_${key}`);
    }
    expect(() => readProviders({ ...full, OIDC_CORP_AUTO_SIGNUP: "1" })).toThrow(
      "OIDC_CORP_AUTO_SIGNUP",
    );
  });

  it("refuses an OIDC id that is not [a-z0-9-]+ or that appears twice", () => {
    expect(() => readProviders({ OIDC_PROVIDERS: "Corp" })).toThrow("OIDC_PROVIDERS");
    expect(() => readProviders({ OIDC_PROVIDERS: "a_b" })).toThrow("OIDC_PROVIDERS");
    expect(() => readProviders({ OIDC_PROVIDERS: "a,,b" })).toThrow("OIDC_PROVIDERS");
    expect(() => readProviders({ OIDC_PROVIDERS: "corp,corp" })).toThrow("corp");
  });

  it("refuses an OIDC id that is a social provider's, which the callback path would share", () => {
    expect(() => readProviders({ OIDC_PROVIDERS: "google" })).toThrow("google");
  });

  it("reads a key with no value, as `.env.example` lists it, as unset", () => {
    const blank: Record<string, string> = { OIDC_PROVIDERS: "" };
    for (const id of ["GITHUB", "GITLAB", "DISCORD", "GOOGLE", "MICROSOFT"]) {
      blank[`${id}_CLIENT_ID`] = "";
      blank[`${id}_CLIENT_SECRET`] = "";
      blank[`${id}_AUTO_SIGNUP`] = "";
    }
    expect(readProviders(blank)).toEqual([]);
    expect(
      readProviders({ ...blank, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })[0]
        ?.autoSignup,
    ).toBe(false);
  });

  it("ignores a value that is not a string", () => {
    expect(readProviders({ GOOGLE_CLIENT_ID: undefined, OIDC_PROVIDERS: 3 })).toEqual([]);
  });
});
