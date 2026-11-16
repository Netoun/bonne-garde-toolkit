/// <reference types="@cloudflare/workers-types" />
import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
// `bg add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import * as authSchema from "{{SCOPE}}/auth/schema";
// oxfmt-ignore
import { resetStatements } from "{{SCOPE}}/db/reset";
import {
  deleteFromR2,
  extractKeyFromUrl,
  generateKey,
  uploadToR2,
  validateFile,
  R2Error,
} from "./r2";
import * as storageSchema from "./schema";
import { medias } from "./schema";
import { TEST_PUBLIC_URL, createTestStorage, startTestBucket } from "./testing";

const testBucket = await startTestBucket();
const { bucket } = testBucket;

afterAll(async () => {
  await testBucket.dispose();
});

beforeEach(async () => {
  await testBucket.empty();
});

// Test helpers

/** The status of an Eden error as a plain number: the client types only the statuses a route declares, and the routes answer 403, 404 and 500 without declaring them. */
function statusOf(error: { status: number } | null): number | null {
  return error?.status ?? null;
}

function createImageFile(content: string, name: string) {
  // JPEG magic bytes: Elysia validates file content, not just the declared MIME type.
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), content], name, {
    type: "image/jpeg",
  });
}

describe("R2 Helper Functions", () => {
  const publicUrl = "https://media.example.com";

  describe("validateFile", () => {
    it("should accept valid image types", () => {
      const validFiles = [
        new File([""], "test.jpg", { type: "image/jpeg" }),
        new File([""], "test.png", { type: "image/png" }),
        new File([""], "test.webp", { type: "image/webp" }),
        new File([""], "test.gif", { type: "image/gif" }),
      ];

      for (const file of validFiles) {
        expect(() => validateFile(file)).not.toThrow();
      }
    });

    it("should reject invalid file types", () => {
      const invalidFiles = [
        new File([""], "test.txt", { type: "text/plain" }),
        new File([""], "test.pdf", { type: "application/pdf" }),
        new File([""], "test.exe", { type: "application/x-msdownload" }),
      ];

      for (const file of invalidFiles) {
        expect(() => validateFile(file)).toThrow(R2Error);
      }
    });

    it("should reject files that are too large", () => {
      const largeContent = new Uint8Array(11 * 1024 * 1024);
      const largeFile = new File([largeContent], "large.jpg", { type: "image/jpeg" });

      expect(() => validateFile(largeFile)).toThrow(R2Error);
    });
  });

  describe("generateKey", () => {
    it("should generate correct key format", () => {
      const key = generateKey("nodes/123", "test-image.jpg");

      expect(key).toMatch(/^medias\/nodes\/123\/[a-f0-9-]+-test-image\.jpg$/);
    });

    it("should sanitize folder paths", () => {
      const key = generateKey("/test/folder/", "file.jpg");

      expect(key).toMatch(/^medias\/test\/folder\/[a-f0-9-]+-file\.jpg$/);
    });

    it("should sanitize filenames without destroying unicode", () => {
      const key = generateKey("test", "file with accents éàè.jpg");

      expect(key).toMatch(/^medias\/test\/[a-f0-9-]+-file with accents éàè\.jpg$/);
    });

    it("should prevent directory traversal", () => {
      const key = generateKey("test", "../../../etc/passwd.jpg");

      expect(key).not.toContain("../");
      expect(key).toMatch(/^medias\/test\/[a-f0-9-]+-_.*etc_passwd\.jpg$/);
    });
  });

  describe("extractKeyFromUrl", () => {
    it("should extract key from URL", () => {
      const url = "https://media.example.com/medias/nodes/123/uuid-test.jpg";

      const key = extractKeyFromUrl(url, publicUrl);

      expect(key).toBe("medias/nodes/123/uuid-test.jpg");
    });

    it("should handle trailing slashes in public URL", () => {
      const url = "https://media.example.com/medias/nodes/123/uuid-test.jpg";

      const key = extractKeyFromUrl(url, "https://media.example.com/");

      expect(key).toBe("medias/nodes/123/uuid-test.jpg");
    });

    it("should return null for URLs not matching public URL", () => {
      const url = "https://other-domain.com/medias/nodes/123/uuid-test.jpg";

      const key = extractKeyFromUrl(url, publicUrl);

      expect(key).toBeNull();
    });
  });

  describe("uploadToR2", () => {
    it("should upload file to R2 bucket", async () => {
      const file = new File(["test-content"], "test.jpg", { type: "image/jpeg" });

      const result = await uploadToR2(bucket, publicUrl, {
        folder: "test",
        file,
      });

      expect(result.url).toMatch(
        /^https:\/\/media\.example\.com\/medias\/test\/[a-f0-9-]+-test\.jpg$/,
      );
      expect(result.key).toMatch(/^medias\/test\/[a-f0-9-]+-test\.jpg$/);

      // Verify the object exists in bucket
      const obj = await bucket.head(result.key);
      expect(obj).not.toBeNull();
      expect(obj?.size).toBe(12); // "test-content".length
      expect(obj?.httpMetadata).toHaveProperty("contentType", "image/jpeg");
    });
  });

  describe("deleteFromR2", () => {
    it("should delete file from R2 bucket", async () => {
      const file = new File(["test-content"], "test.jpg", { type: "image/jpeg" });

      const { key } = await uploadToR2(bucket, publicUrl, {
        folder: "test",
        file,
      });

      // Verify the object exists
      expect(await bucket.head(key)).not.toBeNull();

      // Delete the object
      const result = await deleteFromR2(bucket, key);

      // Verify success
      expect(result.success).toBe(true);

      // Verify the object is deleted
      expect(await bucket.head(key)).toBeNull();
    });
  });
});

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
    it("should upload image and save to database with all metadata", async () => {
      const file = createImageFile("test-image-content", "test-image.jpg");

      const { data, error } = await api.v1.media.post({
        file,
        folder: "test-folder",
        organizationId: orgId,
      });

      expect(error).toBeNull();
      if (!data) throw new Error("Expected uploaded media");
      expect(data.id).toBeDefined();
      expect(data.name).toBe("test-image.jpg");
      expect(data.url).toMatch(
        /^https:\/\/media\.example\.com\/medias\/test-folder\/[a-f0-9-]+-test-image\.jpg$/,
      );
      expect(data.key).toBeDefined();

      // Verify in database
      const mediaRecord = await test.db.select().from(medias).where(eq(medias.id, data.id));
      expect(mediaRecord.length).toBe(1);
      expect(mediaRecord[0].name).toBe("test-image.jpg");
      expect(mediaRecord[0].key).toBe(data.key);
      expect(mediaRecord[0].size).toBe(file.size);
      expect(mediaRecord[0].mimeType).toBe("image/jpeg");
      expect(mediaRecord[0].authorId).toBe(userId);
      expect(mediaRecord[0].organizationId).toBe(orgId);

      // Verify in bucket
      const obj = await bucket.head(data.key);
      expect(obj).not.toBeNull();
    });

    it("should use default folder if not provided", async () => {
      const file = createImageFile("test-content", "test.jpg");

      const { data, error } = await api.v1.media.post({ file });

      expect(error).toBeNull();
      expect(data?.url).toMatch(/\/uploads\//);
    });

    it("should percent-encode the public url and keep the stored key as is", async () => {
      const file = createImageFile("test-content", "é #1 100%?.jpg");

      const { data, error } = await api.v1.media.post({ file, folder: "test-folder" });

      expect(error).toBeNull();
      expect(data?.key).toMatch(/^medias\/test-folder\/[a-f0-9-]+-é #1 100%\?\.jpg$/);
      expect(data?.url).toMatch(
        /^https:\/\/media\.example\.com\/medias\/test-folder\/[a-f0-9-]+-%C3%A9%20%231%20100%25%3F\.jpg$/,
      );
      expect(extractKeyFromUrl(data?.url ?? "", TEST_PUBLIC_URL)).toBe(data?.key ?? "");
    });

    it("should reject a folder that is not a valid key path and store nothing", async () => {
      const file = createImageFile("test-content", "test.jpg");

      const { error } = await api.v1.media.post({ file, folder: "../outside" });

      expect(statusOf(error)).toBe(400);
      expect((await bucket.list()).objects).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
    });

    it("should answer 500 BUCKET_NOT_CONFIGURED when the runtime has no bucket", async () => {
      const withoutBucket = await createTestStorage(undefined);
      const { cookie } = await withoutBucket.signUp("user-2@example.com");

      const { error } = await withoutBucket
        .client(cookie)
        .v1.media.post({ file: createImageFile("test", "test.jpg") });

      expect(statusOf(error)).toBe(500);
      expect(await withoutBucket.db.select().from(medias)).toEqual([]);
    });

    it("should answer 401 without a session, and store nothing", async () => {
      const { error } = await test
        .client()
        .v1.media.post({ file: createImageFile("test", "test.jpg") });

      expect(statusOf(error)).toBe(401);
      expect((await bucket.list()).objects).toEqual([]);
      expect(await test.db.select().from(medias)).toEqual([]);
    });
  });

  describe("DELETE /v1/media/:id", () => {
    it("should delete media and remove from R2 when owner deletes", async () => {
      const { data: uploadData } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        folder: "test",
        organizationId: orgId,
      });
      if (!uploadData) throw new Error("Expected uploaded media");

      // Verify it exists in bucket
      expect(await bucket.head(uploadData.key)).not.toBeNull();

      // Delete it
      const { data, error } = await api.v1.media({ id: uploadData.id }).delete({
        organizationId: orgId,
      });

      expect(error).toBeNull();
      expect(data).toEqual({ success: true, id: uploadData.id });

      // Verify it's removed from bucket
      expect(await bucket.head(uploadData.key)).toBeNull();

      // Verify it's removed from database
      const mediaRecord = await test.db.select().from(medias).where(eq(medias.id, uploadData.id));
      expect(mediaRecord.length).toBe(0);
    });

    it("should return 404 for non-existent media", async () => {
      const { error } = await api.v1.media({ id: "non-existent-id" }).delete();

      expect(statusOf(error)).toBe(404);
    });

    it("should return 403 when unauthorized user tries to delete", async () => {
      // Upload as user-1 with organization
      const { data: uploadData } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploadData) throw new Error("Expected uploaded media");

      // Another user, who is not a member of the organization
      const other = await test.signUp("user-2@example.com");
      await test.addOrganization("org-2", other.userId, "owner");

      // user-2 tries to delete with their own org (org-2), but media belongs to org-1
      const { error } = await test
        .client(other.cookie)
        .v1.media({ id: uploadData.id })
        .delete({ organizationId: "org-2" });

      expect(statusOf(error)).toBe(403);
      expect(await bucket.head(uploadData.key)).not.toBeNull();
    });

    it("should let an admin of the organization delete a member's media", async () => {
      const { data: uploadData } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploadData) throw new Error("Expected uploaded media");
      const admin = await test.signUp("admin@example.com");
      await test.addMember(orgId, admin.userId, "admin");

      const { error } = await test
        .client(admin.cookie)
        .v1.media({ id: uploadData.id })
        .delete({ organizationId: orgId });

      expect(error).toBeNull();
      expect(await bucket.head(uploadData.key)).toBeNull();
    });

    it("should answer 401 without a session, and delete nothing", async () => {
      const { data: uploadData } = await api.v1.media.post({
        file: createImageFile("test-content", "test.jpg"),
      });
      if (!uploadData) throw new Error("Expected uploaded media");

      const { error } = await test.client().v1.media({ id: uploadData.id }).delete();

      expect(statusOf(error)).toBe(401);
      expect(await bucket.head(uploadData.key)).not.toBeNull();
    });
  });

  describe("GET /v1/media/:id", () => {
    it("should return media with author and organization", async () => {
      const { data: uploadData } = await api.v1.media.post({
        file: createImageFile("test", "test.jpg"),
        organizationId: orgId,
      });
      if (!uploadData) throw new Error("Expected uploaded media");

      const { data, error } = await api.v1.media({ id: uploadData.id }).get();

      expect(error).toBeNull();
      expect(data).toMatchObject({
        id: uploadData.id,
        author: { id: userId },
        organization: { id: orgId },
      });
    });

    it("should return 404 for non-existent media", async () => {
      const { error } = await api.v1.media({ id: "non-existent-id" }).get();

      expect(statusOf(error)).toBe(404);
    });
  });

  describe("validation", () => {
    it("should reject invalid file types at Elysia validation level", async () => {
      const file = new File(["test-content"], "test.txt", { type: "text/plain" });

      const { error } = await api.v1.media.post({ file });

      expect(statusOf(error)).toBe(422);
      expect((await bucket.list()).objects).toEqual([]);
    });

    it("should reject files too large at Elysia validation level", async () => {
      const largeContent = new Uint8Array(11 * 1024 * 1024);
      const file = new File([largeContent], "large.jpg", { type: "image/jpeg" });

      const { error } = await api.v1.media.post({ file });

      expect(statusOf(error)).toBe(422);
      expect((await bucket.list()).objects).toEqual([]);
    });
  });
});

describe("R2 Integration - Full Flow", () => {
  it("should complete full upload-download-delete cycle", async () => {
    const publicUrl = "https://media.example.com";

    // Upload
    const file = new File(["image-data-here"], "my-photo.png", { type: "image/png" });
    const { key, url } = await uploadToR2(bucket, publicUrl, {
      folder: "nodes/node-123",
      file,
    });

    expect(url).toContain("/medias/nodes/node-123/");
    expect(url).toContain("-my-photo.png");

    // Verify upload
    const uploaded = await bucket.get(key);
    expect(uploaded).not.toBeNull();
    expect(uploaded?.size).toBe(15); // "image-data-here".length
    expect(uploaded?.httpMetadata).toHaveProperty("contentType", "image/png");

    // List objects
    const list = await bucket.list({ prefix: "medias/nodes/node-123" });
    expect(list.objects.length).toBe(1);
    expect(list.objects[0].key).toBe(key);

    // Delete
    await deleteFromR2(bucket, key);

    // Verify deletion
    expect(await bucket.get(key)).toBeNull();
  });

  it("should handle multiple files in same folder", async () => {
    const publicUrl = "https://media.example.com";

    const files = [
      new File(["content1"], "file1.jpg", { type: "image/jpeg" }),
      new File(["content2"], "file2.png", { type: "image/png" }),
      new File(["content3"], "file3.gif", { type: "image/gif" }),
    ];

    const keys: string[] = [];
    for (const file of files) {
      const result = await uploadToR2(bucket, publicUrl, {
        folder: "test/multiple",
        file,
      });
      keys.push(result.key);
    }

    // Verify all uploaded
    const list = await bucket.list({ prefix: "medias/test/multiple" });
    expect(list.objects.length).toBe(3);

    // Delete all
    for (const key of keys) {
      await deleteFromR2(bucket, key);
    }

    // Verify all deleted
    const emptyList = await bucket.list({ prefix: "medias/test/multiple" });
    expect(emptyList.objects.length).toBe(0);
  });
});

// `db:reset` is `orm/drizzle`'s: it empties every table of the schema barrel, and `medias` is in the barrel
// because this module re-exports it. `medias.author_id` has no cascade, so a media whose organization is not
// deleted first (it has none, or the organization outlives it) stops a delete of its author.
describe("db:reset with media rows", () => {
  const schema = { ...authSchema, ...storageSchema };
  const tables = Object.values(schema)
    .filter((value) => is(value, SQLiteTable))
    .map(getTableName);

  it("empties every table, a media with an author and no organization included", async () => {
    const { db, signUp, addOrganization } = await createTestStorage(undefined);
    const { userId } = await signUp("author@example.com");
    await addOrganization("org-reset", userId, "owner");
    await db.run(sql`PRAGMA foreign_keys = ON`);
    const file = { size: 1, mimeType: "image/png", authorId: userId };
    await db.insert(medias).values([
      { ...file, name: "alone.png", key: "medias/alone.png", url: `${TEST_PUBLIC_URL}/alone.png` },
      {
        ...file,
        name: "owned.png",
        key: "medias/owned.png",
        url: `${TEST_PUBLIC_URL}/owned.png`,
        organizationId: "org-reset",
      },
    ]);
    // What the reset has to get past: the author of a media cannot be deleted while the media is there.
    expect(() => db.run(sql`DELETE FROM "user"`)).toThrow(/Failed to run the query/);

    for (const statement of resetStatements(schema)) {
      await db.run(sql.raw(statement));
    }

    for (const table of tables) {
      const [counted] = await db.all<{ n: number }>(
        sql.raw(`SELECT count(*) AS n FROM "${table}"`),
      );
      expect([table, counted?.n]).toEqual([table, 0]);
    }
  });

  it("is what the project's schema barrel resets: medias is in it, and goes before the user it points at", () => {
    const statements = resetStatements();

    expect(statements).toContain('DELETE FROM "medias";');
    expect(statements.indexOf('DELETE FROM "medias";')).toBeLessThan(
      statements.indexOf('DELETE FROM "user";'),
    );
  });
});
