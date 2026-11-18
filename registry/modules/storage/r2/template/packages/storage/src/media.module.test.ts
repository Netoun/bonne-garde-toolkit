import { describe, it, expect } from "vite-plus/test";
import { Elysia } from "elysia";
import { mediaModule, resolveRuntimeStorage } from "./media.module";

// What `apps/api` mounts, over the runtime this test runs in: no Worker, so no D1 and no R2 binding.
describe("resolveRuntimeStorage", () => {
  it("has no bucket where the runtime binds none, and the local media route as the public url under test", async () => {
    const context = await resolveRuntimeStorage();

    expect(context.bucket).toBeUndefined();
    expect(context.publicUrl).toBe("http://localhost:5172/v1/media/file");
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
