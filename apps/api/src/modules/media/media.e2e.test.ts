/// <reference types="@cloudflare/workers-types" />
import { describe, it, expect, beforeEach } from "bun:test";
import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";
import { createTestDb, type TestDb } from "../../../tests/helpers/db.helpers";
import { user, session, organization, member } from "../db/schemas/db.auth-schema";
import { medias } from "../db/schemas/db.core-schema";
import { MediaService } from "./media.service";
import {
  uploadToR2,
  deleteFromR2,
  extractKeyFromUrl,
  validateFile,
  generateKey,
  R2Error,
} from "../../lib/r2";
import { eq } from "drizzle-orm";

// Mock R2 bucket - implementation for testing
class MockR2Bucket {
  private objects = new Map<string, { value: Uint8Array; contentType?: string }>();

  async put(
    key: string,
    value: Uint8Array | ReadableStream<Uint8Array> | ArrayBuffer | string | Blob,
    options?: R2PutOptions,
  ): Promise<R2Object> {
    let uint8Value: Uint8Array;

    if (value instanceof ReadableStream) {
      const reader = value.getReader();
      const chunks: Uint8Array[] = [];
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) {
          chunks.push(result.value);
        }
      }
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      uint8Value = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        uint8Value.set(chunk, offset);
        offset += chunk.length;
      }
    } else if (value instanceof ArrayBuffer) {
      uint8Value = new Uint8Array(value);
    } else if (typeof value === "string") {
      uint8Value = new TextEncoder().encode(value);
    } else if (value instanceof Blob) {
      uint8Value = new Uint8Array(await value.arrayBuffer());
    } else {
      uint8Value = value;
    }

    const contentType =
      options && "httpMetadata" in options && options.httpMetadata
        ? (options.httpMetadata as R2HTTPMetadata).contentType
        : undefined;

    this.objects.set(key, {
      value: uint8Value,
      contentType,
    });

    return {
      key,
      size: uint8Value.length,
      etag: `"${key}-etag"`,
      httpEtag: `"${key}-etag"`,
      httpMetadata: options?.httpMetadata || {},
      customMetadata: options?.customMetadata || {},
      range: () => undefined,
      checksums: { toJSON: () => ({}) },
      uploaded: new Date(),
      version: "1",
      storageClass: "standard",
      writeHttpMetadata: async () => {},
    };
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    keys.forEach((k) => this.objects.delete(k));
  }

  async head(key: string): Promise<R2Object | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;

    return {
      key,
      size: obj.value.length,
      etag: `"${key}-etag"`,
      httpEtag: `"${key}-etag"`,
      httpMetadata: obj.contentType ? { contentType: obj.contentType } : {},
      customMetadata: {},
      range: () => undefined,
      checksums: { toJSON: () => ({}) },
      uploaded: new Date(),
      version: "1",
      storageClass: "standard",
      writeHttpMetadata: async () => {},
    };
  }

  async get(key: string): Promise<(R2Object & { body: ReadableStream<Uint8Array> }) | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;

    return {
      key,
      size: obj.value.length,
      etag: `"${key}-etag"`,
      httpEtag: `"${key}-etag"`,
      httpMetadata: obj.contentType ? { contentType: obj.contentType } : {},
      customMetadata: {},
      range: () => undefined,
      checksums: { toJSON: () => ({}) },
      uploaded: new Date(),
      version: "1",
      storageClass: "standard",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(obj.value);
          controller.close();
        },
      }),
      writeHttpMetadata: async (headers: Headers) => {
        if (obj.contentType) {
          headers.set("content-type", obj.contentType);
        }
      },
    };
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const objects: R2Object[] = [];
    const prefix = options?.prefix || "";

    for (const [key, obj] of this.objects.entries()) {
      if (key.startsWith(prefix)) {
        objects.push({
          key,
          size: obj.value.length,
          etag: `"${key}-etag"`,
          httpEtag: `"${key}-etag"`,
          httpMetadata: obj.contentType ? { contentType: obj.contentType } : {},
          customMetadata: {},
          range: () => undefined,
          checksums: { toJSON: () => ({}) },
          uploaded: new Date(),
          version: "1",
          storageClass: "standard",
          writeHttpMetadata: async () => {},
        });
      }
    }

    return {
      objects,
      truncated: false,
      delimitedPrefixes: [],
    };
  }

  createMultipartUpload(_key: string, _options?: R2MultipartOptions): R2MultipartUpload {
    throw new Error("Not implemented");
  }

  resumeMultipartUpload(_key: string, _uploadId: string): R2MultipartUpload {
    throw new Error("Not implemented");
  }
}

// Test helpers
async function createTestUserAndOrg(
  db: TestDb,
  userId: string,
  orgId?: string,
): Promise<{ userId: string; orgId?: string }> {
  const now = Date.now();

  await db.insert(user).values({
    id: userId,
    name: `Test User ${userId}`,
    email: `test-${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });

  await db.insert(session).values({
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId: userId,
    expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });

  if (orgId) {
    await db.insert(organization).values({
      id: orgId,
      name: `Test Org ${orgId}`,
      slug: `test-org-${orgId}`,
      createdAt: new Date(now),
    });

    await db.insert(member).values({
      id: `member-${userId}-${orgId}`,
      organizationId: orgId,
      userId: userId,
      role: "owner",
      createdAt: new Date(now),
    });

    return { userId, orgId };
  }

  return { userId };
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
      const bucket = new MockR2Bucket();
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
      const bucket = new MockR2Bucket();
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

describe("MediaService", () => {
  let db: TestDb;
  let bucket: MockR2Bucket;
  let api: ReturnType<typeof treaty<ReturnType<typeof createTestApp>>>;
  const publicUrl = "https://media.example.com";
  let userId: string;
  let orgId: string | undefined;

  function createTestApp() {
    return new Elysia()
      .decorate("db", db)
      .decorate("env", { BUCKET: bucket, R2_PUBLIC_URL: publicUrl })
      .use(MediaService)
      .decorate("user", { id: userId })
      .post("/media/upload", async ({ body, mediaService, user }) => {
        return mediaService.uploadMedia({
          file: body.file,
          folder: body.folder || "uploads",
          userId: user.id,
          organizationId: body.organizationId,
        });
      })
      .delete("/media/:id", async ({ params, mediaService, user, body, set }) => {
        try {
          return await mediaService.deleteMedia({
            id: params.id,
            userId: user.id,
            organizationId: body?.organizationId,
          });
        } catch (error) {
          if (error instanceof R2Error) {
            const statusMap: Record<string, number> = {
              MEDIA_NOT_FOUND: 404,
              UNAUTHORIZED: 403,
              MEDIA_IN_USE: 409,
            };
            set.status = statusMap[error.code] || 500;
            return { error: error.message, code: error.code };
          }
          throw error;
        }
      })
      .get("/media/:id", async ({ params, mediaService, set }) => {
        const media = await mediaService.getMediaById(params.id);
        if (!media) {
          set.status = 404;
          return { error: "Media not found" };
        }
        return media;
      });
  }

  beforeEach(async () => {
    db = createTestDb();
    bucket = new MockR2Bucket();

    const result = await createTestUserAndOrg(db, "user-1", "org-1");
    userId = result.userId;
    orgId = result.orgId;

    const app = createTestApp();
    api = treaty(app);
  });

  describe("uploadMedia", () => {
    it("should upload image and save to database with all metadata", async () => {
      const file = new File(["test-image-content"], "test-image.jpg", {
        type: "image/jpeg",
      });

      const { data, error } = await api.media.upload.post({
        file,
        folder: "test-folder",
        organizationId: orgId,
      });

      expect(error).toBeNull();
      expect(data?.id).toBeDefined();
      expect(data?.name).toBe("test-image.jpg");
      expect(data?.url).toMatch(
        /^https:\/\/media\.example\.com\/medias\/test-folder\/[a-f0-9-]+-test-image\.jpg$/,
      );
      expect(data?.key).toBeDefined();

      // Verify in database
      const mediaRecord = await db
        .select()
        .from(medias)
        .where(eq(medias.id, data?.id || ""));
      expect(mediaRecord.length).toBe(1);
      expect(mediaRecord[0].name).toBe("test-image.jpg");
      expect(mediaRecord[0].key).toBe(data?.key);
      expect(mediaRecord[0].size).toBe(file.size);
      expect(mediaRecord[0].mimeType).toBe("image/jpeg");
      expect(mediaRecord[0].authorId).toBe(userId);
      expect(mediaRecord[0].organizationId).toBe(orgId);

      // Verify in bucket
      const obj = await bucket.head(data?.key || "");
      expect(obj).not.toBeNull();
    });

    it("should use default folder if not provided", async () => {
      const file = new File(["test-content"], "test.jpg", {
        type: "image/jpeg",
      });

      const { data, error } = await api.media.upload.post({ file });

      expect(error).toBeNull();
      expect(data?.url).toMatch(/\/uploads\//);
    });

    it("should percent-encode the public url and keep the stored key as is", async () => {
      const file = new File(["test-content"], "é #1 100%?.jpg", { type: "image/jpeg" });

      const { data, error } = await api.media.upload.post({ file, folder: "test-folder" });

      expect(error).toBeNull();
      expect(data?.key).toMatch(/^medias\/test-folder\/[a-f0-9-]+-é #1 100%\?\.jpg$/);
      expect(data?.url).toMatch(
        /^https:\/\/media\.example\.com\/medias\/test-folder\/[a-f0-9-]+-%C3%A9%20%231%20100%25%3F\.jpg$/,
      );
      expect(extractKeyFromUrl(data?.url ?? "", publicUrl)).toBe(data?.key ?? "");
    });

    it("should reject a folder that is not a valid key path and store nothing", async () => {
      const file = new File(["test-content"], "test.jpg", { type: "image/jpeg" });

      const { error } = await api.media.upload.post({ file, folder: "../outside" });

      expect(error).not.toBeNull();
      expect((await bucket.list()).objects).toEqual([]);
      expect(await db.select().from(medias)).toEqual([]);
    });

    it("should throw error when bucket is not configured", async () => {
      const appWithoutBucket = new Elysia()
        .decorate("db", db)
        .decorate("env", { BUCKET: undefined as unknown as R2Bucket, R2_PUBLIC_URL: publicUrl })
        .use(MediaService)
        .decorate("user", { id: userId })
        .post("/media/upload", async ({ body, mediaService, user }) => {
          return mediaService.uploadMedia({
            file: body.file,
            folder: body.folder || "uploads",
            userId: user.id,
          });
        });

      const apiWithoutBucket = treaty(appWithoutBucket);
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });

      const { error } = await apiWithoutBucket.api.media.upload.post({ file });

      expect(error).toBeDefined();
    });
  });

  describe("deleteMedia", () => {
    it("should delete media and remove from R2 when owner deletes", async () => {
      // First upload a file
      const file = new File(["test-content"], "test.jpg", { type: "image/jpeg" });

      const { data: uploadData } = await api.media.upload.post({
        file,
        folder: "test",
        organizationId: orgId,
      });

      const mediaId = uploadData?.id;
      const mediaKey = uploadData?.key;

      // Verify it exists in bucket
      expect(await bucket.head(mediaKey || "")).not.toBeNull();

      // Delete it
      const { data, error } = await api.media[mediaId!].delete({
        organizationId: orgId,
      });

      expect(error).toBeNull();
      expect(data?.success).toBe(true);
      expect(data?.id).toBe(mediaId);

      // Verify it's removed from bucket
      expect(await bucket.head(mediaKey || "")).toBeNull();

      // Verify it's removed from database
      const mediaRecord = await db
        .select()
        .from(medias)
        .where(eq(medias.id, mediaId || ""));
      expect(mediaRecord.length).toBe(0);
    });

    it("should return 404 for non-existent media", async () => {
      const { error } = await api.media["non-existent-id"].delete();

      expect(error).toBeDefined();
      expect(error?.status).toBe(404);
    });

    it("should return 403 when unauthorized user tries to delete", async () => {
      // Upload as user-1 with organization
      const file = new File(["test-content"], "test.jpg", { type: "image/jpeg" });
      const { data: uploadData } = await api.media.upload.post({
        file,
        organizationId: orgId,
      });

      // Create another user (not a member of the organization)
      await createTestUserAndOrg(db, "user-2", "org-2");

      // Try to delete as user-2 (unauthorized - not the owner and not an org admin)
      const appAsUser2 = new Elysia()
        .decorate("db", db)
        .decorate("env", { BUCKET: bucket, R2_PUBLIC_URL: publicUrl })
        .use(MediaService)
        .decorate("user", { id: "user-2" })
        .delete("/media/:id", async ({ params, mediaService, user, set, body }) => {
          try {
            return await mediaService.deleteMedia({
              id: params.id,
              userId: user.id,
              organizationId: body?.organizationId,
            });
          } catch (error) {
            if (error instanceof R2Error) {
              if (error.code === "UNAUTHORIZED") {
                set.status = 403;
                return { error: error.message };
              }
              if (error.code === "MEDIA_NOT_FOUND") {
                set.status = 404;
                return { error: error.message };
              }
            }
            throw error;
          }
        });

      const apiAsUser2 = treaty(appAsUser2);
      // user-2 tries to delete with their own org (org-2), but media belongs to org-1
      const { error } = await apiAsUser2.media[uploadData!.id].delete({
        organizationId: "org-2",
      });

      expect(error).toBeDefined();
      expect(error?.status).toBe(403);
    });
  });

  describe("getMediaById", () => {
    it("should return media with author and organization", async () => {
      const file = new File(["test"], "test.jpg", { type: "image/jpeg" });
      const { data: uploadData } = await api.media.upload.post({
        file,
        organizationId: orgId,
      });

      const { data, error } = await api.media[uploadData!.id].get();

      expect(error).toBeNull();
      expect(data?.id).toBe(uploadData?.id);
      expect(data?.author).toBeDefined();
      expect(data?.author?.id).toBe(userId);
    });
  });
});

describe("R2 Integration - Full Flow", () => {
  it("should complete full upload-download-delete cycle", async () => {
    const bucket = new MockR2Bucket();
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
    const bucket = new MockR2Bucket();
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

describe("Media Routes - Validation", () => {
  let db: TestDb;
  let bucket: MockR2Bucket;
  const publicUrl = "https://media.example.com";

  beforeEach(async () => {
    db = createTestDb();
    bucket = new MockR2Bucket();
    await createTestUserAndOrg(db, "user-1");
  });

  it("should reject invalid file types at Elysia validation level", async () => {
    const app = new Elysia()
      .decorate("db", db)
      .decorate("env", { BUCKET: bucket, R2_PUBLIC_URL: publicUrl })
      .use(MediaService)
      .decorate("user", { id: "user-1" })
      .post("/media/upload", async ({ body, mediaService, user }) => {
        return mediaService.uploadMedia({
          file: body.file,
          folder: body.folder || "uploads",
          userId: user.id,
        });
      });

    const api = treaty(app).v1;
    const file = new File(["test-content"], "test.txt", { type: "text/plain" });

    const { error } = await api.media.upload.post({ file });

    expect(error).toBeDefined();
    expect(error?.status).toBeGreaterThanOrEqual(400); // Validation error (422 or similar)
  });

  it("should reject files too large at Elysia validation level", async () => {
    const app = new Elysia()
      .decorate("db", db)
      .decorate("env", { BUCKET: bucket, R2_PUBLIC_URL: publicUrl })
      .use(MediaService)
      .decorate("user", { id: "user-1" })
      .post("/media/upload", async ({ body, mediaService, user }) => {
        return mediaService.uploadMedia({
          file: body.file,
          folder: body.folder || "uploads",
          userId: user.id,
        });
      });

    const api = treaty(app).v1;
    const largeContent = new Uint8Array(11 * 1024 * 1024);
    const file = new File([largeContent], "large.jpg", { type: "image/jpeg" });

    const { error } = await api.media.upload.post({ file });

    expect(error).toBeDefined();
    expect(error?.status).toBeGreaterThanOrEqual(400); // Validation error (413 or similar)
  });
});
