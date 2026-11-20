import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { medias } from "./schema";
import { extractKeyFromUrl } from "./storage";
import { TEST_PUBLIC_URL, createTestStorage, startTestBucket } from "./testing";

const testBucket = await startTestBucket();
const { bucket } = testBucket;

afterAll(async () => {
  await testBucket.dispose();
});

beforeEach(async () => {
  await testBucket.empty();
});

/** The status of an Eden error as a plain number: the client types only the statuses a route declares. */
function statusOf(error: { status: number } | null): number | null {
  return error?.status ?? null;
}

function createImageFile(content: string, name: string) {
  // JPEG magic bytes: Elysia validates file content, not just the declared MIME type.
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), content], name, {
    type: "image/jpeg",
  });
}

/** Every file under `dir`, as paths relative to it: what is on the disk, whatever the service says. */
async function filesUnder(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1));
}

describe("the media routes", () => {
  let test: Awaited<ReturnType<typeof createTestStorage>>;
  let userId: string;
  let orgId: string;
  let api: ReturnType<typeof test.client>;

  beforeEach(async () => {
    test = await createTestStorage(bucket);
    const user = await test.signUp("user-1@example.com");
    userId = user.userId;
    orgId = "org-1";
    await test.addOrganization(orgId, userId, "owner");
    api = test.client(user.cookie);
  });

  describe("POST /v1/media", () => {
    it("writes the file under <DATA_DIR>/media/<key> and records it with its author and organization", async () => {
      const file = createImageFile("test-content", "test.jpg");

      const { data, error } = await api.v1.media.post({
        file,
        folder: "test-folder",
        organizationId: orgId,
      });

      expect(error).toBeNull();
      if (!data) throw new Error("Expected uploaded media");
      expect(data.key).toMatch(/^medias\/test-folder\/[a-f0-9-]+-test\.jpg$/);
      expect(data.url).toContain(`${TEST_PUBLIC_URL}/medias/test-folder/`);
      expect(await filesUnder(testBucket.root)).toEqual([data.key]);
      expect(new Uint8Array(await readFile(join(testBucket.root, data.key)))).toEqual(
        new Uint8Array(await file.arrayBuffer()),
      );
      const [row] = await test.db.select().from(medias).where(eq(medias.id, data.id));
      expect(row).toMatchObject({
        name: "test.jpg",
        key: data.key,
        url: data.url,
        size: file.size,
        mimeType: "image/jpeg",
        authorId: userId,
        organizationId: orgId,
      });
    });

    it("uses the uploads folder by default, and percent-encodes the url but not the key", async () => {
      const { data, error } = await api.v1.media.post({
        file: createImageFile("test-content", "é #1 100%?.jpg"),
      });

      expect(error).toBeNull();
      expect(data?.key).toMatch(/^medias\/uploads\/[a-f0-9-]+-é #1 100%\?\.jpg$/);
      expect(data?.url).toMatch(/\/uploads\/[a-f0-9-]+-%C3%A9%20%231%20100%25%3F\.jpg$/);
      expect(extractKeyFromUrl(data?.url ?? "", TEST_PUBLIC_URL)).toBe(data?.key ?? "");
    });

    it("rejects a folder that leaves the media directory, and writes nothing", async () => {
      const { error } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        folder: "../outside",
      });

      expect(statusOf(error)).toBe(400);
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
    });

    it("answers 401 without a session, and stores nothing", async () => {
      const { error } = await test
        .client()
        .v1.media.post({ file: createImageFile("test", "test.jpg") });

      expect(statusOf(error)).toBe(401);
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
    });

    it("rejects a file type or size Elysia validates, and stores nothing", async () => {
      const text = new File(["test-content"], "test.txt", { type: "text/plain" });
      const large = new File([new Uint8Array(11 * 1024 * 1024)], "large.jpg", {
        type: "image/jpeg",
      });

      for (const file of [text, large]) {
        const { error } = await api.v1.media.post({ file });
        expect(statusOf(error)).toBe(422);
      }
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
    });
  });

  describe("GET /v1/media/file/*", () => {
    it("reads back the same bytes and content type an upload wrote, with no session", async () => {
      // A real 1x1 PNG: Elysia checks the signature and the structure of an image.
      const png = new Uint8Array(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
          "base64",
        ),
      );
      const file = new File([png], "a.png", { type: "image/png" });
      const { data } = await api.v1.media.post({ file });
      if (!data) throw new Error("Expected uploaded media");

      const response = await test.app.handle(
        new Request(data.url.replace(TEST_PUBLIC_URL, "http://api.test/v1/media/file")),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array(await file.arrayBuffer()),
      );
    });

    it("returns 404 for a key with no file, and for a folder", async () => {
      const { data } = await api.v1.media.post({ file: createImageFile("x", "a.jpg") });
      if (!data) throw new Error("Expected uploaded media");

      for (const path of ["medias/nodes/missing.png", "medias/uploads"]) {
        const response = await test.app.handle(
          new Request(`http://api.test/v1/media/file/${path}`),
        );
        expect(response.status).toBe(404);
      }
    });
  });

  describe("DELETE /v1/media/:id", () => {
    it("removes the file and the row when the author deletes", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploaded) throw new Error("Expected uploaded media");
      expect(await filesUnder(testBucket.root)).toEqual([uploaded.key]);

      const { data, error } = await api.v1.media({ id: uploaded.id }).delete({
        organizationId: orgId,
      });

      expect(error).toBeNull();
      expect(data).toEqual({ success: true, id: uploaded.id });
      expect(await filesUnder(testBucket.root)).toEqual([]);
      expect(await test.db.select().from(medias).where(eq(medias.id, uploaded.id))).toEqual([]);
    });

    it("returns 404 for media that does not exist", async () => {
      const { error } = await api.v1.media({ id: "non-existent-id" }).delete();

      expect(statusOf(error)).toBe(404);
    });

    it("returns 403 to a user of another organization, and keeps the file", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploaded) throw new Error("Expected uploaded media");
      const other = await test.signUp("user-2@example.com");
      await test.addOrganization("org-2", other.userId, "owner");

      const { error } = await test
        .client(other.cookie)
        .v1.media({ id: uploaded.id })
        .delete({ organizationId: "org-2" });

      expect(statusOf(error)).toBe(403);
      expect(await filesUnder(testBucket.root)).toEqual([uploaded.key]);
    });

    it("lets an admin of the organization delete a member's media", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploaded) throw new Error("Expected uploaded media");
      const admin = await test.signUp("admin@example.com");
      await test.addMember(orgId, admin.userId, "admin");

      const { error } = await test
        .client(admin.cookie)
        .v1.media({ id: uploaded.id })
        .delete({ organizationId: orgId });

      expect(error).toBeNull();
      expect(await filesUnder(testBucket.root)).toEqual([]);
    });

    it("answers 401 without a session, and deletes nothing", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
      });
      if (!uploaded) throw new Error("Expected uploaded media");

      const { error } = await test.client().v1.media({ id: uploaded.id }).delete();

      expect(statusOf(error)).toBe(401);
      expect(await filesUnder(testBucket.root)).toEqual([uploaded.key]);
    });
  });

  describe("GET /v1/media/:id", () => {
    it("returns the media with its author and organization, and 404 for none", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploaded) throw new Error("Expected uploaded media");

      const { data, error } = await api.v1.media({ id: uploaded.id }).get();
      const { error: missing } = await api.v1.media({ id: "non-existent-id" }).get();

      expect(error).toBeNull();
      expect(data).toMatchObject({
        id: uploaded.id,
        author: { id: userId },
        organization: { id: orgId },
      });
      expect(statusOf(missing)).toBe(404);
    });
  });
});
