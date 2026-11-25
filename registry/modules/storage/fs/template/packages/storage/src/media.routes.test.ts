import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { generateKey, publicUrlFor } from "./storage";
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
  it("serves a file, with no session, whose filename has spaces, accents, #, % and ?", async () => {
    // A key a client can no longer make an upload write (the key is random now), but an object may still hold one.
    const key = "medias/nodes/1/é #1 100%?.png";
    await bucket.put(key, new TextEncoder().encode("pixels"));
    // What the API hands to clients, reduced to the path the route receives.
    const encodedKeyPath = publicUrlFor(TEST_PUBLIC_URL, key).slice(`${TEST_PUBLIC_URL}/`.length);

    const response = await app.handle(fileRequest(encodedKeyPath));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
    expect(await response.text()).toBe("pixels");
  });

  it("serves a file nobody recorded as bytes, with no content type to claim", async () => {
    await bucket.put("medias/orphan.png", new Uint8Array([1]));

    const response = await app.handle(fileRequest("medias/orphan.png"));

    expect(response.headers.get("content-type")).toContain("application/octet-stream");
  });

  it("returns 404 for a key with no file", async () => {
    const response = await app.handle(fileRequest("medias/nodes/1/missing.png"));

    expect(response.status).toBe(404);
  });

  it("returns 400 INVALID_KEY for an unsafe key, `..` encoded or not, an absolute one, a control character", async () => {
    for (const unsafe of [
      "medias/..%2Fsecret",
      "..%2F..%2Fetc%2Fpasswd",
      "%2Fetc%2Fpasswd",
      "medias/x%00y",
      "medias/a%0Ab",
      "medias//x",
    ]) {
      const response = await app.handle(fileRequest(unsafe));

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_KEY" });
    }
  });

  it("returns 400 INVALID_KEY for a key that goes through a symbolic link out of the media directory", async () => {
    const outside = join(testBucket.dataDir, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "secret.png"), "secret");
    await mkdir(testBucket.root, { recursive: true });
    await symlink(outside, join(testBucket.root, "link"));

    const response = await app.handle(fileRequest("link/secret.png"));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_KEY" });
    expect(await readdir(outside)).toEqual(["secret.png"]);
  });
});

describe("the module's prefix", () => {
  it("serves the routes under /v1/media and nowhere else", async () => {
    const key = generateKey("nodes/1", "image/png");
    await bucket.put(key, new Uint8Array([1]));
    const path = publicUrlFor("", key).slice(1);

    const under = await app.handle(new Request(`http://api.test/v1/media/file/${path}`));
    const without = await app.handle(new Request(`http://api.test/media/file/${path}`));

    expect(under.status).toBe(200);
    expect(without.status).toBe(404);
  });
});
