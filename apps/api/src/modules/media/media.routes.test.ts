import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { generateKey, publicUrlFor } from "@acme/api/lib/r2";
import { mediaRoutes } from "./media.routes";

const PUBLIC_URL = "https://media.example.com";

/** In-memory stand-in for the one R2 method the file route reaches: `get`. */
class FakeBucket {
  readonly requestedKeys: string[] = [];

  constructor(private readonly objects: ReadonlyMap<string, Blob>) {}

  async get(key: string) {
    this.requestedKeys.push(key);
    const blob = this.objects.get(key);
    if (!blob) return null;
    return { blob: async () => blob, httpMetadata: { contentType: blob.type } };
  }
}

function createApp(bucket: FakeBucket) {
  return new Elysia()
    .decorate("db", {})
    .decorate("env", { BUCKET: bucket, R2_PUBLIC_URL: PUBLIC_URL })
    .use(mediaRoutes);
}

function fileRequest(encodedKeyPath: string): Request {
  return new Request(`http://api.test/media/file/${encodedKeyPath}`);
}

describe("GET /media/file/*", () => {
  it("serves an object whose filename has spaces, accents, #, % and ?", async () => {
    const key = generateKey("nodes/1", "é #1 100%?.png");
    const bucket = new FakeBucket(new Map([[key, new Blob(["pixels"], { type: "image/png" })]]));
    // What the API hands to clients, reduced to the path the route receives.
    const encodedKeyPath = publicUrlFor(PUBLIC_URL, key).slice(`${PUBLIC_URL}/`.length);

    const response = await createApp(bucket).handle(fileRequest(encodedKeyPath));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(await response.text()).toBe("pixels");
    expect(bucket.requestedKeys).toEqual([key]);
  });

  it("returns 404 for a key that is not in the bucket", async () => {
    const bucket = new FakeBucket(new Map());

    const response = await createApp(bucket).handle(fileRequest("medias/nodes/1/missing.png"));

    expect(response.status).toBe(404);
  });

  it("returns 400 INVALID_KEY without reaching the bucket for an unsafe key", async () => {
    const bucket = new FakeBucket(new Map());
    const app = createApp(bucket);

    for (const unsafe of ["medias/..%2Fsecret", "medias/x%00y", "medias/a%0Ab", "medias//x"]) {
      const response = await app.handle(fileRequest(unsafe));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_KEY" });
    }
    expect(bucket.requestedKeys).toEqual([]);
  });
});
