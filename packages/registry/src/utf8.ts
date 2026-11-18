const STRICT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * The text of `bytes`, or `null` when they are not valid UTF-8, which is what makes a template file
 * binary (035). A byte order mark is kept, as reading the file as UTF-8 keeps it.
 */
export function utf8Text(bytes: Uint8Array): string | null {
  try {
    return STRICT.decode(bytes);
  } catch {
    return null;
  }
}
