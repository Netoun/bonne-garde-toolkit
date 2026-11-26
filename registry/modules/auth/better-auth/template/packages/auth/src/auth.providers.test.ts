import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import type { SignInProvider } from "./providers";
import { account, user } from "./schema";
import { TEST_API_URL, TEST_APP_URL, createTestAuth } from "./testing";

const google: SignInProvider = {
  id: "google",
  kind: "social",
  label: "Google",
  autoSignup: false,
  options: { clientId: "google-client", clientSecret: "google-secret" },
};

type Profile = { sub: string; email: string; email_verified: boolean; name: string };

/**
 * An OpenID provider on a local port: the discovery document, the token endpoint and the user info
 * endpoint, over real HTTP. `profile` is what the person who signs in is, and a test sets it.
 */
async function startIdp() {
  const idp = {
    profile: {
      sub: "idp-1",
      email: "ada@example.com",
      email_verified: true,
      name: "Ada",
    } as Profile,
    issuer: "",
    server: undefined as unknown as Server,
  };
  idp.server = createServer((request, response) => {
    const send = (body: unknown) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(body));
    };
    const path = new URL(request.url ?? "/", idp.issuer).pathname;
    if (path === "/.well-known/openid-configuration") {
      send({
        issuer: idp.issuer,
        authorization_endpoint: `${idp.issuer}/authorize`,
        token_endpoint: `${idp.issuer}/token`,
        userinfo_endpoint: `${idp.issuer}/userinfo`,
      });
    } else if (path === "/token") {
      send({ access_token: "idp-access-token", token_type: "Bearer", expires_in: 3600 });
    } else if (path === "/userinfo") {
      send(idp.profile);
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((resolve) => idp.server.listen(0, "127.0.0.1", resolve));
  idp.issuer = `http://127.0.0.1:${(idp.server.address() as AddressInfo).port}`;
  return idp;
}

const idps: Server[] = [];
afterEach(async () => {
  await Promise.all(
    idps.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function corp(options: { autoSignup?: boolean } = {}) {
  const idp = await startIdp();
  idps.push(idp.server);
  const provider: SignInProvider = {
    id: "corp",
    kind: "oidc",
    label: "Corp SSO",
    autoSignup: options.autoSignup ?? false,
    options: { issuer: idp.issuer, clientId: "corp-client", clientSecret: "corp-secret" },
  };
  return { idp, provider };
}

describe("a social provider", () => {
  it("sends the person to the provider, with the client id and the callback the provider must allow", async () => {
    const { call } = await createTestAuth({ providers: [google] });

    const response = await call("/sign-in/social", {
      body: { provider: "google", callbackURL: TEST_APP_URL },
    });

    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const authorization = new URL(url);
    expect(authorization.hostname).toBe("accounts.google.com");
    expect(authorization.searchParams.get("client_id")).toBe("google-client");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      `${TEST_API_URL}/api/auth/callback/google`,
    );
  });

  it("is refused when no provider is configured", async () => {
    const { call } = await createTestAuth();

    const response = await call("/sign-in/social", {
      body: { provider: "google", callbackURL: TEST_APP_URL },
    });

    expect(response.ok).toBe(false);
  });
});

describe("an OIDC provider", () => {
  it("sends the person to the authorization endpoint its discovery document names", async () => {
    const { idp, provider } = await corp();
    const { call } = await createTestAuth({ providers: [provider] });

    const response = await call("/sign-in/oauth2", {
      body: { providerId: "corp", callbackURL: TEST_APP_URL },
    });

    expect(response.status).toBe(200);
    const { url } = (await response.json()) as { url: string };
    const authorization = new URL(url);
    expect(`${authorization.origin}${authorization.pathname}`).toBe(`${idp.issuer}/authorize`);
    expect(authorization.searchParams.get("client_id")).toBe("corp-client");
    expect(authorization.searchParams.get("redirect_uri")).toBe(
      `${TEST_API_URL}/api/auth/oauth2/callback/corp`,
    );
    expect(authorization.searchParams.get("scope")).toBe("openid email profile");
  });
});

/** Signs in with the `corp` provider up to the provider's answer, and returns what the callback answers. */
async function comeBackFromCorp(test: Awaited<ReturnType<typeof createTestAuth>>) {
  const start = await test.call("/sign-in/oauth2", {
    body: { providerId: "corp", callbackURL: TEST_APP_URL, errorCallbackURL: TEST_APP_URL },
  });
  const { url } = (await start.json()) as { url: string };
  const cookie = start.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0])
    .join("; ");
  const state = new URL(url).searchParams.get("state") ?? "";
  const back = await test.call(
    `/oauth2/callback/corp?code=the-code&state=${encodeURIComponent(state)}`,
    { cookie },
  );
  const location = new URL(back.headers.get("location") ?? "http://missing.test");
  return {
    location,
    signedIn: back.headers.getSetCookie().some((entry) => entry.includes("session_token")),
  };
}

describe("signing in that creates no account unless the provider has autoSignup", () => {
  it("refuses a person who has no account when autoSignup is off", async () => {
    const { provider } = await corp();
    const test = await createTestAuth({ providers: [provider] });

    const { location, signedIn } = await comeBackFromCorp(test);

    expect(signedIn).toBe(false);
    expect(location.searchParams.get("error")).toBe("signup_disabled");
    expect(await test.db.select().from(user)).toEqual([]);
  });

  it("creates the account and signs the person in when autoSignup is on", async () => {
    const { provider } = await corp({ autoSignup: true });
    const test = await createTestAuth({ providers: [provider] });

    const { location, signedIn } = await comeBackFromCorp(test);

    expect(location.origin).toBe(TEST_APP_URL);
    expect(location.searchParams.get("error")).toBeNull();
    expect(signedIn).toBe(true);
    const created = await test.db.select().from(user);
    expect(created.map(({ email }) => email)).toEqual(["ada@example.com"]);
  });

  it("lets a person who has an account sign in when autoSignup is off", async () => {
    const { idp, provider } = await corp();
    const test = await createTestAuth({ providers: [provider] });
    await test.signIn(idp.profile.email);

    const { signedIn } = await comeBackFromCorp(test);

    expect(signedIn).toBe(true);
  });
});

describe("linking an external account to an existing one", () => {
  it("does not, when the provider does not say the email is verified", async () => {
    const { idp, provider } = await corp({ autoSignup: true });
    const test = await createTestAuth({ providers: [provider] });
    await test.signIn("ada@example.com");
    idp.profile = { ...idp.profile, email_verified: false };

    const { location, signedIn } = await comeBackFromCorp(test);

    expect(signedIn).toBe(false);
    expect(location.searchParams.get("error")).toBe("account_not_linked");
    expect(await test.db.select().from(account).where(eq(account.providerId, "corp"))).toEqual([]);
  });

  it("does, onto the account of that email, when it does", async () => {
    const { provider } = await corp({ autoSignup: true });
    const test = await createTestAuth({ providers: [provider] });
    await test.signIn("ada@example.com");
    const [existing] = await test.db.select().from(user);

    const { signedIn } = await comeBackFromCorp(test);

    expect(signedIn).toBe(true);
    const linked = await test.db.select().from(account).where(eq(account.providerId, "corp"));
    expect(linked.map(({ userId }) => userId)).toEqual([existing?.id]);
    expect(await test.db.select().from(user)).toHaveLength(1);
  });

  it("is written in the config, with no trusted provider, for every provider", async () => {
    const { provider } = await corp();
    const { auth } = await createTestAuth({ providers: [google, provider] });

    const { options } = await auth.$context;

    expect(options.account?.accountLinking).toMatchObject({
      enabled: true,
      requireLocalEmailVerified: true,
    });
    expect(options.account?.accountLinking).not.toHaveProperty("trustedProviders");
  });
});

describe("the rate limit on the provider sign-in endpoints", () => {
  it("lets a client start ten a minute on each, and not an eleventh", async () => {
    const { provider } = await corp();
    const { call } = await createTestAuth({
      providers: [google, provider],
      clientIpHeaders: ["cf-connecting-ip"],
    });
    const social: number[] = [];
    const oauth2: number[] = [];

    for (let attempt = 0; attempt < 11; attempt += 1) {
      const options = { ip: "203.0.113.40" };
      social.push(
        (
          await call("/sign-in/social", {
            ...options,
            body: { provider: "google", callbackURL: TEST_APP_URL },
          })
        ).status,
      );
      oauth2.push(
        (
          await call("/sign-in/oauth2", {
            ...options,
            body: { providerId: "corp", callbackURL: TEST_APP_URL },
          })
        ).status,
      );
    }

    expect(social.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(social[10]).toBe(429);
    expect(oauth2.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(oauth2[10]).toBe(429);
  });
});
