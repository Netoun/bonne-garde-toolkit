import { createHash } from "node:crypto";

/** SHA-256 of a string (as its UTF-8 bytes) or of raw bytes, as 64 lowercase hex characters. */
export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}
