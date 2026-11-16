import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { generateKey, publicUrlFor } from "./r2";
import { TEST_PUBLIC_URL, createTestStorage, startTestBucket } from "./testing";

const testBucket = await startTestBucket();
const { bucket } = testBucket;
let app: Awaited<ReturnType<typeof createTestStorage>>["app"];

beforeEach(async () => {
  await testBucket.empty();
  app = (await createTestStorage(bucket)).app;
});

afterAll(async () => {
  await testBucket.dispose();
});

function fileRequest(encodedKeyPath: string): Request {
  return new Request(`http://api.test/v1/media/file/${encodedKeyPath}`);
}

describe("GET /v1/media/file/*", () => {
  it("serves an object, with no session, whose filename has spaces, accents, #, % and ?", async () => {
    const key = generateKey("nodes/1", "é #1 100%?.png");
    await bucket.put(key, "pixels", { httpMetadata: { contentType: "image/png" } });
    // What the API hands to clients, reduced to the path the route receives.
    const encodedKeyPath = publicUrlFor(TEST_PUBLIC_URL, key).slice(`${TEST_PUBLIC_URL}/`.length);

    const response = await app.handle(fileRequest(encodedKeyPath));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
    expect(await response.text()).toBe("pixels");
  });

  it("returns 404 for a key that is not in the bucket", async () => {
    const response = await app.handle(fileRequest("medias/nodes/1/missing.png"));

    expect(response.status).toBe(404);
  });

  it("returns 400 INVALID_KEY without reaching the bucket for an unsafe key", async () => {
    // An object under the unsafe key would be served if the route let the key through.
    await bucket.put("medias//x", "secret");
    await bucket.put("medias/a\nb", "secret");

    for (const unsafe of ["medias/..%2Fsecret", "medias/x%00y", "medias/a%0Ab", "medias//x"]) {
      const response = await app.handle(fileRequest(unsafe));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_KEY" });
    }
  });
});

describe("the module's prefix", () => {
  it("serves the routes under /v1/media and nowhere else", async () => {
    const key = generateKey("nodes/1", "a.png");
    await bucket.put(key, "pixels", { httpMetadata: { contentType: "image/png" } });
    const path = publicUrlFor("", key).slice(1);

    const under = await app.handle(new Request(`http://api.test/v1/media/file/${path}`));
    const without = await app.handle(new Request(`http://api.test/media/file/${path}`));

    expect(under.status).toBe(200);
    expect(without.status).toBe(404);
  });
});
