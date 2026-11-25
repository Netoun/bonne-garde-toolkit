import { describe, expect, it } from "vite-plus/test";
import { SIGNED_URL_TTL_SECONDS, signMediaUrl, verifyMediaSignature } from "./signed-url";

const SECRET = "a-secret-of-at-least-32-characters!";
const KEY = "medias/docs/3f2b8c1e-0000-4000-8000-000000000001.png";
const URL_OF_KEY = `https://media.example.com/${KEY}`;
const NOW = 1_800_000_000_000;

/** What the file route reads from a signed url: its key is the path, the rest is the query. */
function parts(signed: string) {
  const url = new URL(signed);
  return {
    expires: url.searchParams.get("expires") ?? "",
    signature: url.searchParams.get("signature") ?? "",
  };
}

describe("a signed media url", () => {
  it("is the file url with an expiry 15 minutes ahead and a hex signature", async () => {
    const signed = await signMediaUrl({ secret: SECRET, key: KEY, url: URL_OF_KEY, now: NOW });

    expect(signed.startsWith(`${URL_OF_KEY}?expires=`)).toBe(true);
    expect(parts(signed).expires).toBe(String(NOW / 1000 + SIGNED_URL_TTL_SECONDS));
    expect(SIGNED_URL_TTL_SECONDS).toBe(900);
    expect(parts(signed).signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies for the key it was signed for, and says how many seconds are left", async () => {
    const signed = await signMediaUrl({ secret: SECRET, key: KEY, url: URL_OF_KEY, now: NOW });

    expect(
      await verifyMediaSignature({ secret: SECRET, key: KEY, ...parts(signed), now: NOW }),
    ).toBe(900);
    expect(
      await verifyMediaSignature({
        secret: SECRET,
        key: KEY,
        ...parts(signed),
        now: NOW + 600_000,
      }),
    ).toBe(300);
  });

  it("does not verify for another key", async () => {
    const signed = await signMediaUrl({ secret: SECRET, key: KEY, url: URL_OF_KEY, now: NOW });

    expect(
      await verifyMediaSignature({
        secret: SECRET,
        key: "medias/docs/other.png",
        ...parts(signed),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("does not verify when expires was changed", async () => {
    const { expires, signature } = parts(
      await signMediaUrl({ secret: SECRET, key: KEY, url: URL_OF_KEY, now: NOW }),
    );

    expect(
      await verifyMediaSignature({
        secret: SECRET,
        key: KEY,
        expires: String(Number(expires) + 3600),
        signature,
        now: NOW,
      }),
    ).toBeNull();
  });

  it("does not verify once expires is past, even with a good signature", async () => {
    const signed = await signMediaUrl({ secret: SECRET, key: KEY, url: URL_OF_KEY, now: NOW });
    const afterExpiry = NOW + (SIGNED_URL_TTL_SECONDS + 1) * 1000;

    expect(
      await verifyMediaSignature({ secret: SECRET, key: KEY, ...parts(signed), now: afterExpiry }),
    ).toBeNull();
  });

  it("does not verify under another secret", async () => {
    const signed = await signMediaUrl({ secret: SECRET, key: KEY, url: URL_OF_KEY, now: NOW });

    expect(
      await verifyMediaSignature({
        secret: "another-secret-of-at-least-32-chars!",
        key: KEY,
        ...parts(signed),
        now: NOW,
      }),
    ).toBeNull();
  });

  it("does not verify a missing, malformed or truncated signature or expiry", async () => {
    const { expires, signature } = parts(
      await signMediaUrl({ secret: SECRET, key: KEY, url: URL_OF_KEY, now: NOW }),
    );
    const verify = (values: { expires: string; signature: string }) =>
      verifyMediaSignature({ secret: SECRET, key: KEY, ...values, now: NOW });

    expect(await verify({ expires, signature: "" })).toBeNull();
    expect(await verify({ expires, signature: signature.slice(0, 62) })).toBeNull();
    expect(await verify({ expires, signature: "z".repeat(64) })).toBeNull();
    expect(await verify({ expires: "", signature })).toBeNull();
    expect(await verify({ expires: "soon", signature })).toBeNull();
  });
});
