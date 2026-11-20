/**
 * Storage helpers: file and key validation, public urls, and the upload and delete of a file over a
 * `MediaBucket`. The names and error codes are those of `storage/r2`, so what a project writes
 * against one module runs against the other.
 */
import type { MediaBucket } from "./bucket";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export interface UploadOptions {
  folder: string;
  file: File;
}

export interface UploadResult {
  key: string;
  url: string;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

/** The error of the media service. Named `R2Error` in `storage/r2` too; its codes are the same, but `BUCKET_NOT_CONFIGURED`: a directory is always there. */
export class R2Error extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_FILE_TYPE"
      | "INVALID_KEY"
      | "FILE_TOO_LARGE"
      | "R2_UPLOAD_FAILED"
      | "R2_DELETE_FAILED"
      | "MEDIA_NOT_FOUND"
      | "MEDIA_IN_USE"
      | "UNAUTHORIZED",
  ) {
    super(message);
    this.name = "R2Error";
  }
}

export function validateFile(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type as AllowedImageType)) {
    throw new R2Error(
      `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
      "INVALID_FILE_TYPE",
    );
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new R2Error(
      `File too large: ${file.size} bytes. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      "FILE_TOO_LARGE",
    );
  }
}

/**
 * Rejects keys that a public URL could not address safely, and that a path could not hold inside
 * the media directory: empty, `.` / `..` or empty segments (so no absolute key either), backslashes
 * and control characters.
 */
export function validateKey(key: string): void {
  if (
    !key ||
    /[\\\0-\x1F\x7F]/.test(key) || // eslint-disable-line no-control-regex
    key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new R2Error("Invalid media key", "INVALID_KEY");
  }
}

export function generateKey(folder: string, filename: string): string {
  const sanitizedFolder = folder.replace(/^\/+|\/+$/g, "");
  const uuid = crypto.randomUUID();

  // Sanitize filename: remove path separators and prevent directory traversal
  // Keep Unicode letters, numbers, and safe special characters
  const sanitizedFilename = filename
    .replace(/[/\\]/g, "_") // Path separators
    .replace(/\.{2,}/g, "_") // Directory traversal attempts
    .replace(/[\0-\x1F\x7F]/g, ""); // eslint-disable-line no-control-regex

  const key = `medias/${sanitizedFolder}/${uuid}-${sanitizedFilename}`;
  // The filename is sanitized above; only the caller-supplied folder can still be invalid.
  validateKey(key);
  return key;
}

/** Public URL of an object. Each path segment is encoded so `#`, `?`, `%` and spaces in a filename stay in the path. */
export function publicUrlFor(publicUrl: string, key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${publicUrl}/${encodedKey}`;
}

/** Inverse of `publicUrlFor`: the decoded key, or `null` for a foreign url or a malformed percent escape. */
export function extractKeyFromUrl(url: string, publicUrl: string): string | null {
  const normalizedPublicUrl = publicUrl.replace(/\/+$/, "");
  if (!url.startsWith(normalizedPublicUrl)) {
    return null;
  }
  const path = url.slice(normalizedPublicUrl.length);
  const encodedKey = path.startsWith("/") ? path.slice(1) : path;
  try {
    return encodedKey.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

export async function uploadFile(
  bucket: MediaBucket,
  publicUrl: string,
  options: UploadOptions,
): Promise<UploadResult> {
  validateFile(options.file);

  const key = generateKey(options.folder, options.file.name);
  const bytes = new Uint8Array(await options.file.arrayBuffer());

  try {
    await bucket.put(key, bytes);
  } catch (error) {
    // A key the bucket refuses is the caller's, not a failure of the disk.
    if (error instanceof R2Error) throw error;
    throw new R2Error(
      `Failed to write the file: ${error instanceof Error ? error.message : "Unknown error"}`,
      "R2_UPLOAD_FAILED",
    );
  }

  return { key, url: publicUrlFor(publicUrl, key) };
}

export async function deleteFile(bucket: MediaBucket, key: string): Promise<DeleteResult> {
  try {
    await bucket.delete(key);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export { ALLOWED_IMAGE_TYPES, MAX_FILE_SIZE };
