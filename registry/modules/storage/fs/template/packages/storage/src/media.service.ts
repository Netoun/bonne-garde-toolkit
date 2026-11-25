import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import type * as authSchema from "{{SCOPE}}/auth/schema";
import type { MediaBucket } from "./bucket";
import { R2Error, deleteFile, uploadFile, validateKey, type UploadResult } from "./storage";
import * as storageSchema from "./schema";

const { medias } = storageSchema;

/**
 * A Drizzle SQLite database that has the tables media reads: its own, and the auth tables its
 * foreign keys and ownership checks reach. D1 in a Worker and the test database both are one.
 */
export type StorageDatabase = BaseSQLiteDatabase<
  "sync" | "async",
  unknown,
  typeof authSchema & typeof storageSchema
>;

/** What the media service runs against: the database, the bucket of the files, and the public url of a file. */
export type StorageContext = {
  db: StorageDatabase;
  bucket: MediaBucket;
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
  ): Promise<Pick<UploadResult, "key" | "url"> & { id: string; name: string }> => {
    try {
      // Write the file first
      const { key, url, mimeType } = await uploadFile(bucket, publicUrl, {
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
        mimeType,
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

    // Delete the file. A failure is ignored: the DB record is the source of truth.
    if (media.key) {
      await deleteFile(bucket, media.key);
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

  const getFile = async (key: string): Promise<{ blob: Blob; contentType: string } | null> => {
    // The key comes straight from the request URL.
    validateKey(key);

    try {
      const bytes = await bucket.get(key);
      if (!bytes) {
        return null;
      }

      // The type is the one the upload recorded; a file with no record is served as bytes.
      const media = await db.query.medias.findFirst({
        where: eq(medias.key, key),
        columns: { mimeType: true },
      });

      return {
        blob: new Blob([bytes]),
        contentType: media?.mimeType ?? "application/octet-stream",
      };
    } catch (error) {
      // An unsafe key is the caller's, whatever the bucket made of it.
      if (error instanceof R2Error) throw error;
      throw new R2Error(
        `Failed to read the file: ${error instanceof Error ? error.message : "Unknown error"}`,
        "R2_UPLOAD_FAILED",
      );
    }
  };

  return {
    uploadMedia,
    deleteMedia,
    getMediaById,
    getFile,
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
