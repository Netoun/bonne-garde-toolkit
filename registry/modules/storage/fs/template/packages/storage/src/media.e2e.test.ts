import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
// `bonne-garde add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import * as authSchema from "{{SCOPE}}/auth/schema";
// oxfmt-ignore
import { readLibsql } from "{{SCOPE}}/db/libsql";
// oxfmt-ignore
import { createTestDb } from "{{SCOPE}}/db/testing";
import { createMediaService } from "./media.service";
import * as storageSchema from "./schema";
import { medias } from "./schema";
import { extractKeyFromUrl } from "./storage";
import { TEST_PUBLIC_URL, createTestStorage, startTestBucket } from "./testing";

/** A table of a project that points at a media with a plain foreign key: no `onDelete`, so the media stays while a row holds it. */
const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  mediaId: text("media_id")
    .notNull()
    .references(() => medias.id),
});

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

/** A real 1x1 PNG. */
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

function createPngFile(name: string, type = "image/png") {
  return new File([PNG], name, { type });
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
      expect(data.key).toMatch(/^medias\/test-folder\/[a-f0-9-]{36}\.jpg$/);
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

    it("uses the uploads folder by default, and keeps the client filename out of the key and the url", async () => {
      const { data, error } = await api.v1.media.post({
        file: createImageFile("test-content", "é #1 100%?.jpg"),
      });

      expect(error).toBeNull();
      if (!data) throw new Error("Expected uploaded media");
      expect(data.name).toBe("é #1 100%?.jpg");
      expect(data.key).toMatch(/^medias\/uploads\/[a-f0-9-]{36}\.jpg$/);
      expect(data.url).toBe(`${TEST_PUBLIC_URL}/${data.key}`);
      expect(extractKeyFromUrl(data.url, TEST_PUBLIC_URL)).toBe(data.key);
      const [row] = await test.db.select().from(medias).where(eq(medias.id, data.id));
      expect(row?.name).toBe("é #1 100%?.jpg");
    });

    it("stores a real PNG uploaded as image/png with its detected type and a random .png key", async () => {
      const { data, error } = await api.v1.media.post({ file: createPngFile("holiday photo.png") });

      expect(error).toBeNull();
      if (!data) throw new Error("Expected uploaded media");
      expect(data.key).toMatch(/^medias\/[^/]+\/[0-9a-f-]{36}\.png$/);
      const [row] = await test.db.select().from(medias).where(eq(medias.id, data.id));
      expect(row?.mimeType).toBe("image/png");
    });

    it("refuses a real PNG uploaded as image/jpeg with 400, and stores nothing", async () => {
      const { error } = await api.v1.media.post({ file: createPngFile("photo.jpg", "image/jpeg") });

      expect(statusOf(error)).toBe(400);
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
    });

    it("refuses a text file declared image/png with 400, and stores nothing", async () => {
      const file = new File(["not an image"], "fake.png", { type: "image/png" });

      const { error } = await api.v1.media.post({ file });

      expect(statusOf(error)).toBe(400);
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
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

    it("answers 403 to a user who is not a member of the organization, and writes no row nor file", async () => {
      const outsider = await test.signUp("outsider@example.com");

      const { error } = await test.client(outsider.cookie).v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });

      expect(statusOf(error)).toBe(403);
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
    });

    it("lets a plain member of the organization upload to it", async () => {
      const member = await test.signUp("member@example.com");
      await test.addMember(orgId, member.userId, "member");

      const { data, error } = await test.client(member.cookie).v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });

      expect(error).toBeNull();
      const [row] = await test.db
        .select()
        .from(medias)
        .where(eq(medias.id, data?.id ?? ""));
      expect(row).toMatchObject({ authorId: member.userId, organizationId: orgId });
    });

    it("answers 401 without a session, and stores nothing", async () => {
      const { error } = await test
        .client()
        .v1.media.post({ file: createImageFile("test", "test.jpg") });

      expect(statusOf(error)).toBe(401);
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
    });

    it("refuses a text file declared text/plain with 400, and a file over 10 MB with 422 (Elysia's), and stores nothing", async () => {
      const text = new File(["test-content"], "test.txt", { type: "text/plain" });
      const large = new File([new Uint8Array(11 * 1024 * 1024)], "large.jpg", {
        type: "image/jpeg",
      });

      expect(statusOf((await api.v1.media.post({ file: text })).error)).toBe(400);
      expect(statusOf((await api.v1.media.post({ file: large })).error)).toBe(422);
      expect(await filesUnder(testBucket.dataDir)).toEqual([]);
    });
  });

  describe("GET /v1/media/file/*", () => {
    it("reads back the same bytes and content type an upload wrote, with no session", async () => {
      const file = createPngFile("a.png");
      const { data } = await api.v1.media.post({ file });
      if (!data) throw new Error("Expected uploaded media");

      const response = await test.app.handle(
        new Request(data.url.replace(TEST_PUBLIC_URL, "http://api.test/v1/media/file")),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("image/png");
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
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

      const { data, error } = await api.v1.media({ id: uploaded.id }).delete();

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

      const { error } = await test.client(other.cookie).v1.media({ id: uploaded.id }).delete();

      expect(statusOf(error)).toBe(403);
      expect(await filesUnder(testBucket.root)).toEqual([uploaded.key]);
    });

    it("returns 403 to a plain member who is not the author, and keeps the file", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploaded) throw new Error("Expected uploaded media");
      const member = await test.signUp("member@example.com");
      await test.addMember(orgId, member.userId, "member");

      const { error } = await test.client(member.cookie).v1.media({ id: uploaded.id }).delete();

      expect(statusOf(error)).toBe(403);
      expect(await filesUnder(testBucket.root)).toEqual([uploaded.key]);
      expect(await test.db.select().from(medias).where(eq(medias.id, uploaded.id))).toHaveLength(1);
    });

    it("lets an admin of the organization delete a member's media", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploaded) throw new Error("Expected uploaded media");
      const admin = await test.signUp("admin@example.com");
      await test.addMember(orgId, admin.userId, "admin");

      const { error } = await test.client(admin.cookie).v1.media({ id: uploaded.id }).delete();

      expect(error).toBeNull();
      expect(await filesUnder(testBucket.root)).toEqual([]);
    });

    describe("a media that another table points at", () => {
      /** A signed-in user's PNG, and the routes over a database that also has the `attachments` table. */
      async function uploadWithReferrer() {
        const withTable = await createTestStorage(bucket, { attachments });
        const owner = await withTable.signUp("owner@example.com");
        const client = withTable.client(owner.cookie);
        const { data: uploaded } = await client.v1.media.post({ file: createPngFile("photo.png") });
        if (!uploaded) throw new Error("Expected uploaded media");
        return { withTable, client, uploaded };
      }

      it("answers 409 MEDIA_IN_USE and keeps the row and the file while a row points at it", async () => {
        const { withTable, client, uploaded } = await uploadWithReferrer();
        await withTable.db.insert(attachments).values({ id: "attachment-1", mediaId: uploaded.id });

        const { data, error } = await client.v1.media({ id: uploaded.id }).delete();

        expect(data).toBeNull();
        expect(statusOf(error)).toBe(409);
        expect(error?.value).toMatchObject({ code: "MEDIA_IN_USE" });
        expect(
          await withTable.db.select().from(medias).where(eq(medias.id, uploaded.id)),
        ).toHaveLength(1);
        expect(await filesUnder(testBucket.root)).toEqual([uploaded.key]);
      });

      it("deletes the row and the file once nothing points at it", async () => {
        const { withTable, client, uploaded } = await uploadWithReferrer();

        const { error } = await client.v1.media({ id: uploaded.id }).delete();

        expect(error).toBeNull();
        expect(await withTable.db.select().from(medias).where(eq(medias.id, uploaded.id))).toEqual(
          [],
        );
        expect(await filesUnder(testBucket.root)).toEqual([]);
      });
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
    it("returns the media with its author and organization to its author, and 404 for none", async () => {
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

    it("returns it to a member of the media's organization, whatever the role", async () => {
      const { data: uploaded } = await api.v1.media.post({
        file: createImageFile("test", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploaded) throw new Error("Expected uploaded media");
      const member = await test.signUp("member@example.com");
      await test.addMember(orgId, member.userId, "member");

      const { data, error } = await test.client(member.cookie).v1.media({ id: uploaded.id }).get();

      expect(error).toBeNull();
      expect(data).toMatchObject({ id: uploaded.id });
    });

    it("answers 404 to a user who shares no organization with the author, for a media of an organization or of none", async () => {
      const { data: inOrg } = await api.v1.media.post({
        file: createImageFile("test", "test.jpg"),
        organizationId: orgId,
      });
      const { data: alone } = await api.v1.media.post({
        file: createImageFile("test", "alone.jpg"),
      });
      if (!inOrg || !alone) throw new Error("Expected uploaded media");
      const other = await test.signUp("user-2@example.com");
      await test.addOrganization("org-2", other.userId, "owner");
      const otherApi = test.client(other.cookie);

      expect(statusOf((await otherApi.v1.media({ id: inOrg.id }).get()).error)).toBe(404);
      expect(statusOf((await otherApi.v1.media({ id: alone.id }).get()).error)).toBe(404);
    });
  });
});

describe("deleting a media over a libsql file database", () => {
  // The database `readLibsql()` opens for the dockerfile provider, not the in-memory one the routes are tested over.
  it("refuses a media a row points at with MEDIA_IN_USE and deletes it once nothing does", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "storage-libsql-"));
    try {
      const client = await readLibsql({ DATA_DIR: dataDir, NODE_ENV: "test" });
      const db = await createTestDb({ ...authSchema, ...storageSchema, attachments }, client);
      await db
        .insert(authSchema.user)
        .values({ id: "user-1", name: "Ada", email: "ada@example.com" });
      const service = createMediaService({ db, bucket, publicUrl: TEST_PUBLIC_URL });
      const uploaded = await service.uploadMedia({
        file: createPngFile("photo.png"),
        folder: "uploads",
        userId: "user-1",
      });
      await db.insert(attachments).values({ id: "attachment-1", mediaId: uploaded.id });

      await expect(
        service.deleteMedia({ id: uploaded.id, userId: "user-1" }),
      ).rejects.toMatchObject({ code: "MEDIA_IN_USE" });
      expect(await db.select().from(medias).where(eq(medias.id, uploaded.id))).toHaveLength(1);
      expect(await filesUnder(testBucket.root)).toEqual([uploaded.key]);

      await db.delete(attachments).where(eq(attachments.id, "attachment-1"));
      await expect(service.deleteMedia({ id: uploaded.id, userId: "user-1" })).resolves.toEqual({
        success: true,
        id: uploaded.id,
      });
      expect(await db.select().from(medias).where(eq(medias.id, uploaded.id))).toEqual([]);
      expect(await filesUnder(testBucket.root)).toEqual([]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
