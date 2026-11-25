/**
 * Short-lived urls for private media. The API signs them, nothing else holds a copy: the signing key
 * is the HMAC-SHA-256 of a fixed label under `BETTER_AUTH_SECRET`, so the auth secret itself never
 * signs a url, and no environment key is added. Web Crypto only, so the same code runs on Workers and Node.
 */

/** The label the secret signs to give the key that signs urls. */
const KEY_LABEL = "bonne-garde:media-url";

/** How long a signed url is valid. */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

const HMAC = { name: "HMAC", hash: "SHA-256" } as const;
const encoder = new TextEncoder();

async function signingKey(secret: string): Promise<CryptoKey> {
  const root = await crypto.subtle.importKey("raw", encoder.encode(secret), HMAC, false, ["sign"]);
  const derived = await crypto.subtle.sign(HMAC, root, encoder.encode(KEY_LABEL));
  return crypto.subtle.importKey("raw", derived, HMAC, false, ["sign", "verify"]);
}

const payload = (key: string, expires: string | number) => encoder.encode(`${key}\n${expires}`);

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/**
 * `url` (the public url of the file `key`) with the expiry and the signature of `<key>\n<expires>`
 * in its query. `now` is in milliseconds.
 */
export async function signMediaUrl(options: {
  secret: string;
  key: string;
  url: string;
  now?: number;
}): Promise<string> {
  const expires = Math.floor((options.now ?? Date.now()) / 1000) + SIGNED_URL_TTL_SECONDS;
  const signature = toHex(
    await crypto.subtle.sign(HMAC, await signingKey(options.secret), payload(options.key, expires)),
  );
  return `${options.url}?expires=${expires}&signature=${signature}`;
}

/**
 * The seconds a signature has left for `key`, or `null` when `expires` or `signature` is missing,
 * malformed, past, or not the one `secret` makes for this key and expiry. `subtle.verify` compares in
 * constant time. `now` is in milliseconds.
 */
export async function verifyMediaSignature(options: {
  secret: string;
  key: string;
  expires?: string | undefined;
  signature?: string | undefined;
  now?: number;
}): Promise<number | null> {
  const { expires, signature } = options;
  if (!expires || !signature || !/^\d+$/.test(expires)) return null;

  const secondsLeft = Number(expires) - Math.floor((options.now ?? Date.now()) / 1000);
  if (secondsLeft <= 0) return null;

  const expected = fromHex(signature);
  if (!expected) return null;

  const valid = await crypto.subtle.verify(
    HMAC,
    await signingKey(options.secret),
    expected,
    payload(options.key, expires),
  );
  return valid ? secondsLeft : null;
}
