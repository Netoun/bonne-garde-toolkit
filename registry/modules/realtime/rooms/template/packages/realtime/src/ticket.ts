/**
 * The ticket that opens a room: a signed claim `{ room, subject, tags, exp }`, issued by the app from
 * its own authorized route and checked when the socket upgrades. The module ships no route that hands
 * one out, because who may enter a room is the app's rule. HMAC-SHA256 over Web Crypto, so it runs on
 * Node and on Workers alike.
 */
import Type, { type Static } from "typebox";
import { Check } from "typebox/value";

export const SECRET_ENV = "REALTIME_TICKET_SECRET";
const TEST_SECRET = "realtime-ticket-secret-for-tests";

const claimsSchema = Type.Object({
  room: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1 }),
  tags: Type.Array(Type.String()),
  /** Expiry, in seconds since the epoch. */
  exp: Type.Integer(),
});

export type TicketClaims = Static<typeof claimsSchema>;

export function isTicketClaims(value: unknown): value is TicketClaims {
  return Check(claimsSchema, value);
}

/** A ticket that cannot open the room asked for: `reason` says why, for the log, not for the client. */
export class InvalidTicketError extends Error {
  constructor(readonly reason: "malformed" | "signature" | "expired" | "room") {
    super(`Invalid realtime ticket: ${reason}`);
    this.name = "InvalidTicketError";
  }
}

/** The signing secret: `REALTIME_TICKET_SECRET`, a fixture under `NODE_ENV=test`, an error otherwise. */
export function readTicketSecret(source: Record<string, string | undefined> = process.env): string {
  const secret = source[SECRET_ENV];
  if (secret) return secret;
  if (source.NODE_ENV === "test") return TEST_SECRET;
  throw new Error(
    `${SECRET_ENV} is not set: generate one (openssl rand -base64 32) and put it in .env`,
  );
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function signingKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export type IssueTicketOptions = {
  room: string;
  subject: string;
  tags?: readonly string[];
  ttlSeconds: number;
  /** Defaults to `readTicketSecret()`. */
  secret?: string;
  /** The clock, in milliseconds: a test passes its own. */
  now?: number;
};

export async function issueTicket(options: IssueTicketOptions): Promise<string> {
  const {
    room,
    subject,
    tags = [],
    ttlSeconds,
    secret = readTicketSecret(),
    now = Date.now(),
  } = options;
  const claims: TicketClaims = {
    room,
    subject,
    tags: [...tags],
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const payload = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await signingKey(secret, "sign"),
    encoder.encode(payload),
  );
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** The claims of a ticket that was signed with the secret, has not expired, and is for `room`; throws otherwise. */
export async function verifyTicket(
  ticket: string,
  room: string,
  options: { secret?: string; now?: number } = {},
): Promise<TicketClaims> {
  const { secret = readTicketSecret(), now = Date.now() } = options;
  const [payload, signature, ...rest] = ticket.split(".");
  if (payload === undefined || signature === undefined || rest.length > 0) {
    throw new InvalidTicketError("malformed");
  }

  let signed: boolean;
  try {
    signed = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret, "verify"),
      fromBase64Url(signature),
      encoder.encode(payload),
    );
  } catch {
    throw new InvalidTicketError("malformed");
  }
  if (!signed) throw new InvalidTicketError("signature");

  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
  } catch {
    throw new InvalidTicketError("malformed");
  }
  if (!isTicketClaims(claims)) throw new InvalidTicketError("malformed");
  if (claims.exp * 1000 <= now) throw new InvalidTicketError("expired");
  if (claims.room !== room) throw new InvalidTicketError("room");
  return claims;
}
