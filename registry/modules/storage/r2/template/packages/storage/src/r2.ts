/**
 * R2 Storage Helper
 * Helper functions for Cloudflare R2 bucket operations
 */
/// <reference types="@cloudflare/workers-types" />

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export interface UploadOptions {
  folder: string;
  file: File;
}

export interface UploadResult {
  key: string;
  url: string;
  /** The type read from the file's bytes, not the one the client declared. */
  mimeType: AllowedImageType;
}

export interface DeleteResult {
  success: boolean;
  error?: string;
}

export class R2Error extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_FILE_TYPE"
      | "INVALID_KEY"
      | "FILE_TOO_LARGE"
      | "R2_UPLOAD_FAILED"
      | "R2_DELETE_FAILED"
      | "BUCKET_NOT_CONFIGURED"
      | "MEDIA_NOT_FOUND"
      | "MEDIA_IN_USE"
      | "UNAUTHORIZED",
  ) {
    super(message);
    this.name = "R2Error";
  }
}

const IMAGE_EXTENSIONS: Record<AllowedImageType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Enough bytes to tell every type apart: `RIFF....WEBP` is the longest signature. */
const SIGNATURE_LENGTH = 12;

const hasBytes = (bytes: Uint8Array, offset: number, expected: readonly number[]) =>
  expected.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/** The image type the first bytes say, or `null`: hand-written signatures, so the same code runs on Workers and Node. */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasBytes(bytes, 0, ascii("GIF87a")) || hasBytes(bytes, 0, ascii("GIF89a"))) {
    return "image/gif";
  }
  if (hasBytes(bytes, 0, ascii("RIFF")) && hasBytes(bytes, 8, ascii("WEBP"))) return "image/webp";
  return null;
}

/**
 * Checks the size, then the content: the type read from the file's bytes must be an allowed image
 * and the one the client declared. Returns the detected type, the only one that is stored.
 */
export async function validateFile(file: File): Promise<AllowedImageType> {
  if (file.size > MAX_FILE_SIZE) {
    throw new R2Error(
      `File too large: ${file.size} bytes. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      "FILE_TOO_LARGE",
    );
  }

  const detected = detectImageType(
    new Uint8Array(await file.slice(0, SIGNATURE_LENGTH).arrayBuffer()),
  );
  if (!detected || detected !== file.type) {
    throw new R2Error(
      `Invalid file type: the content is ${detected ?? "not an allowed image"}, the file says ${file.type || "nothing"}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
      "INVALID_FILE_TYPE",
    );
  }

  return detected;
}

/**
 * Rejects keys that a public URL could not address safely: empty, `.` / `..` or empty
 * segments, backslashes and control characters. R2 keys are flat, but a `..` segment
 * is collapsed by any URL parser, so such an object could never be fetched back.
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

/** `medias/<folder>/<uuid>.<ext>`: the client's filename is not in the key, it stays in `medias.name`. */
export function generateKey(folder: string, type: AllowedImageType): string {
  const sanitizedFolder = folder.replace(/^\/+|\/+$/g, "");
  const key = `medias/${sanitizedFolder}/${crypto.randomUUID()}.${IMAGE_EXTENSIONS[type]}`;
  // Only the caller-supplied folder can still be invalid.
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

export async function uploadToR2(
  bucket: R2Bucket,
  publicUrl: string,
  options: UploadOptions,
): Promise<UploadResult> {
  const mimeType = await validateFile(options.file);

  const key = generateKey(options.folder, mimeType);
  const arrayBuffer = await options.file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  try {
    await bucket.put(key, uint8Array, {
      httpMetadata: {
        contentType: mimeType,
      },
    });
  } catch (error) {
    throw new R2Error(
      `Failed to upload to R2: ${error instanceof Error ? error.message : "Unknown error"}`,
      "R2_UPLOAD_FAILED",
    );
  }

  const url = publicUrlFor(publicUrl, key);

  return { key, url, mimeType };
}

export async function deleteFromR2(bucket: R2Bucket, key: string): Promise<DeleteResult> {
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
