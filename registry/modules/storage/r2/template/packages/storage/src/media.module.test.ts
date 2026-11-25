import { describe, it, expect } from "vite-plus/test";
import { Elysia } from "elysia";
import { mediaModule, resolveRuntimeStorage } from "./media.module";

/**
 * Runs `body` with some variables of the process set (or unset, for `undefined`), then puts them back.
 * Under Bun `readRuntimeEnv()` is the process environment, and `NODE_ENV` is what wrangler inlines in
 * a Worker: `production` in what it deploys, `development` under `wrangler dev`.
 */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
  set(vars);
  try {
    return await body();
  } finally {
    set(before);
  }
}

// What `apps/api` mounts, over the runtime this test runs in: no Worker, so no D1 and no R2 binding.
describe("resolveRuntimeStorage", () => {
  it("has no bucket where the runtime binds none, and the local media route as the public url under test", async () => {
    const context = await resolveRuntimeStorage();

    expect(context.bucket).toBeUndefined();
    expect(context.publicUrl).toBe("http://localhost:5172/v1/media/file");
  });

  it("signs private urls with the BETTER_AUTH_SECRET auth owns", async () => {
    const { secret } = await withEnv(
      { BETTER_AUTH_SECRET: "the-project-auth-secret" },
      resolveRuntimeStorage,
    );

    expect(secret).toBe("the-project-auth-secret");
  });

  it("serves its files under the origin the API was given in development, with no public url to set", async () => {
    const context = await withEnv(
      {
        NODE_ENV: "development",
        BETTER_AUTH_SECRET: "dev-secret",
        R2_PUBLIC_URL: undefined,
        API_URL: "https://api.acme.localhost",
      },
      resolveRuntimeStorage,
    );

    expect(context.publicUrl).toBe("https://api.acme.localhost/v1/media/file");
  });

  it("keeps the public url it is given in development", async () => {
    const context = await withEnv(
      {
        NODE_ENV: "development",
        BETTER_AUTH_SECRET: "dev-secret",
        R2_PUBLIC_URL: "https://media.acme.com",
        API_URL: "https://api.acme.localhost",
      },
      resolveRuntimeStorage,
    );

    expect(context.publicUrl).toBe("https://media.acme.com");
  });

  it("fails naming R2_PUBLIC_URL in production, whatever origin the API has", async () => {
    const resolve = withEnv(
      { NODE_ENV: "production", R2_PUBLIC_URL: undefined, API_URL: "https://api.acme.com" },
      resolveRuntimeStorage,
    );

    await expect(resolve).rejects.toThrow(/Missing required environment variables: R2_PUBLIC_URL/);
  });

  it("builds a database that names the D1 binding when something first uses it", async () => {
    const { db } = await resolveRuntimeStorage();

    // Drizzle prepares the statement while it builds the query, so the throw can come from either:
    // the async function turns both into the rejection.
    await expect((async () => db.query.medias.findFirst())()).rejects.toThrow(/"DB"/);
  });
});

describe("mediaModule, as the API mounts it", () => {
  const app = new Elysia().use(mediaModule);

  it("answers a file request with BUCKET_NOT_CONFIGURED, not a crash, when the runtime has no bucket", async () => {
    const response = await app.handle(new Request("http://api.test/v1/media/file/medias/a/b.png"));

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "BUCKET_NOT_CONFIGURED" });
  });

  it("fails the first request that needs the public url in production, naming the key, and not before", async () => {
    // The shell boots, and nothing is read, until a route of the module is asked something.
    await withEnv({ NODE_ENV: "production", R2_PUBLIC_URL: undefined }, async () => {
      const response = await app.handle(
        new Request("http://api.test/v1/media/file/medias/a/b.png"),
      );

      expect(response.status).toBe(500);
      expect(await response.text()).toContain("R2_PUBLIC_URL");
    });
  });

  it("answers 401 to a request with no session before it reaches the database or the bucket", async () => {
    const body = new FormData();
    body.set(
      "file",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "a.jpg", { type: "image/jpeg" }),
    );

    const response = await app.handle(
      new Request("http://api.test/v1/media", { method: "POST", body }),
    );

    expect(response.status).toBe(401);
  });
});
