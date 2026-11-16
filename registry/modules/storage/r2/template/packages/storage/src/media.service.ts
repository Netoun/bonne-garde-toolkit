/// <reference types="@cloudflare/workers-types" />
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import type * as authSchema from "{{SCOPE}}/auth/schema";
import { R2Error, deleteFromR2, uploadToR2, validateKey, type UploadResult } from "./r2";
import * as storageSchema from "./schema";

const { medias } = storageSchema;

/**
 * A Drizzle SQLite database that has the tables media reads: its own, and the auth tables its
 * foreign keys and ownership checks reach. D1 in a Worker and `bun:sqlite` in a test both are one.
 */
export type StorageDatabase = BaseSQLiteDatabase<
  "sync" | "async",
  unknown,
  typeof authSchema & typeof storageSchema
>;

/** What the media service runs against: the database, the bucket if the runtime has one, and the public url of a file. */
export type StorageContext = {
  db: StorageDatabase;
  bucket: R2Bucket | undefined;
  publicUrl: string;
};

/** How the routes get the context: a function, so that nothing is read at import time. */
export type ResolveStorage = () => Promise<StorageContext>;

export interface UploadMediaInput {
  file: File;
  folder: string;
  userId: string;
  organizationId?: string;
}

export interface DeleteMediaInput {
  id: string;
  userId: string;
  organizationId?: string;
}

export function createMediaService({ db, bucket, publicUrl }: StorageContext) {
  const checkMediaReferences = async (_mediaId: string): Promise<unknown[]> => {
    return [];
  };

  const verifyOwnership = async (
    mediaId: string,
    userId: string,
    organizationId?: string,
  ): Promise<boolean> => {
    const media = await db.query.medias.findFirst({
      where: eq(medias.id, mediaId),
      columns: { authorId: true, organizationId: true },
    });

    if (!media) return false;

    // Media owner can always delete
    if (media.authorId === userId) return true;

    // Organization admin can delete organization's media
    if (organizationId && media.organizationId === organizationId) {
      // Check if user is admin of the organization
      const membership = await db.query.member.findFirst({
        where: (member, { eq, and }) =>
          and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
        columns: { role: true },
      });

      return membership?.role === "admin" || membership?.role === "owner";
    }

    return false;
  };

  const uploadMedia = async (
    input: UploadMediaInput,
  ): Promise<UploadResult & { id: string; name: string }> => {
    if (!bucket) {
      throw new R2Error("R2 bucket not configured", "BUCKET_NOT_CONFIGURED");
    }

    try {
      // Upload to R2 first
      const { key, url } = await uploadToR2(bucket, publicUrl, {
        folder: input.folder,
        file: input.file,
      });

      // Then save to database
      const mediaId = crypto.randomUUID();
      await db.insert(medias).values({
        id: mediaId,
        name: input.file.name,
        url,
        key,
        size: input.file.size,
        mimeType: input.file.type,
        authorId: input.userId,
        organizationId: input.organizationId,
        createdAt: new Date(),
      });

      return { id: mediaId, url, key, name: input.file.name };
    } catch (error) {
      // If it's already an R2Error, rethrow it
      if (error instanceof R2Error) {
        throw error;
      }

      // Wrap other errors
      throw new R2Error(
        `Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        "R2_UPLOAD_FAILED",
      );
    }
  };

  const deleteMedia = async (
    input: DeleteMediaInput,
  ): Promise<{ success: boolean; id: string }> => {
    // Fetch media record
    const media = await db.query.medias.findFirst({
      where: eq(medias.id, input.id),
      columns: { id: true, key: true, authorId: true, organizationId: true },
    });

    if (!media) {
      throw new R2Error("Media not found", "MEDIA_NOT_FOUND");
    }

    // Verify ownership
    const hasPermission = await verifyOwnership(input.id, input.userId, input.organizationId);
    if (!hasPermission) {
      throw new R2Error("Unauthorized to delete this media", "UNAUTHORIZED");
    }

    // Check if media is in use
    const references = await checkMediaReferences(input.id);
    if (references.length > 0) {
      throw new R2Error(
        `Media is in use by ${references.length} resource(s) and cannot be deleted`,
        "MEDIA_IN_USE",
      );
    }

    // Delete from R2 if bucket is available
    if (bucket && media.key) {
      const deleteResult = await deleteFromR2(bucket, media.key);
      if (!deleteResult.success) {
        // The file might not exist in R2 anymore
        // Error is silently ignored as the DB record is the source of truth
        void deleteResult.error;
      }
    }

    // Delete from database
    await db.delete(medias).where(eq(medias.id, input.id));

    return { success: true, id: input.id };
  };

  const getMediaById = async (id: string) => {
    return db.query.medias.findFirst({
      where: eq(medias.id, id),
      with: {
        author: {
          columns: { id: true, name: true, email: true },
        },
        organization: {
          columns: { id: true, name: true },
        },
      },
    });
  };

  const getFileFromR2 = async (
    key: string,
  ): Promise<{ blob: Blob; contentType: string } | null> => {
    // The key comes straight from the request URL.
    validateKey(key);

    if (!bucket) {
      throw new R2Error("R2 bucket not configured", "BUCKET_NOT_CONFIGURED");
    }

    try {
      const object = await bucket.get(key);
      if (!object) {
        return null;
      }

      const blob = await object.blob();
      const contentType = object.httpMetadata?.contentType ?? "application/octet-stream";

      return { blob, contentType };
    } catch (error) {
      throw new R2Error(
        `Failed to fetch from R2: ${error instanceof Error ? error.message : "Unknown error"}`,
        "R2_UPLOAD_FAILED",
      );
    }
  };

  return {
    uploadMedia,
    deleteMedia,
    getMediaById,
    getFileFromR2,
    checkMediaReferences,
    verifyOwnership,
  };
}

/** Puts `mediaService` on the context of every route registered after it. */
export function mediaServicePlugin(resolveStorage: ResolveStorage) {
  return new Elysia({ name: "media.service" }).derive({ as: "scoped" }, async () => ({
    mediaService: createMediaService(await resolveStorage()),
  }));
}
