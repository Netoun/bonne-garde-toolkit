import { describe, it, expect } from "bun:test";
import { extractKeyFromUrl, generateKey, publicUrlFor, R2Error, validateKey } from "./r2";

const PUBLIC_URL = "https://media.example.com";

function rejection(action: () => void): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("validateKey", () => {
  it("accepts a generated-style key", () => {
    expect(() => validateKey("medias/nodes/123/uuid-test.jpg")).not.toThrow();
  });

  it("accepts dots inside a segment", () => {
    expect(() => validateKey("medias/a/photo..v2.jpg")).not.toThrow();
  });

  it("rejects an empty key", () => {
    expect(() => validateKey("")).toThrow(R2Error);
  });

  it("rejects `.` and `..` segments", () => {
    for (const key of ["..", ".", "medias/../x", "medias/./x", "../x", "medias/x/.."]) {
      expect(() => validateKey(key)).toThrow(R2Error);
    }
  });

  it("rejects empty segments", () => {
    for (const key of ["/medias/x", "medias/x/", "medias//x"]) {
      expect(() => validateKey(key)).toThrow(R2Error);
    }
  });

  it("rejects control characters and backslashes", () => {
    for (const key of ["medias/a\0b", "medias/a\nb", "medias/a\tb", "medias/a\x7Fb", "medias\\x"]) {
      expect(() => validateKey(key)).toThrow(R2Error);
    }
  });

  it("fails with the INVALID_KEY code", () => {
    const error = rejection(() => validateKey("medias/../x"));

    expect(error).toBeInstanceOf(R2Error);
    expect(error instanceof R2Error && error.code).toBe("INVALID_KEY");
  });
});

describe("generateKey", () => {
  it("rejects a folder that traverses upward", () => {
    expect(() => generateKey("../secret", "a.jpg")).toThrow(R2Error);
    expect(() => generateKey("nodes/../../secret", "a.jpg")).toThrow(R2Error);
  });

  it("rejects an empty folder and empty folder segments", () => {
    expect(() => generateKey("", "a.jpg")).toThrow(R2Error);
    expect(() => generateKey("/", "a.jpg")).toThrow(R2Error);
    expect(() => generateKey("nodes//123", "a.jpg")).toThrow(R2Error);
  });

  it("rejects a folder containing control characters", () => {
    expect(() => generateKey("nodes\n123", "a.jpg")).toThrow(R2Error);
  });

  it("still produces a valid key for an awkward filename", () => {
    const key = generateKey("nodes/123", "../../../etc/pass wd\0.jpg");

    expect(() => validateKey(key)).not.toThrow();
  });
});

describe("publicUrlFor", () => {
  it("joins the public url and the key", () => {
    expect(publicUrlFor(PUBLIC_URL, "medias/test/uuid-photo.jpg")).toBe(
      "https://media.example.com/medias/test/uuid-photo.jpg",
    );
  });

  it("percent-encodes each path segment and keeps the separators", () => {
    expect(publicUrlFor(PUBLIC_URL, "medias/my folder/uuid-é #1 100%?.jpg")).toBe(
      "https://media.example.com/medias/my%20folder/uuid-%C3%A9%20%231%20100%25%3F.jpg",
    );
  });

  it("does not let a filename change the url's path, query or fragment", () => {
    const url = new URL(publicUrlFor(PUBLIC_URL, "medias/test/uuid-a?b=c#d.jpg"));

    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(url.pathname).toBe("/medias/test/uuid-a%3Fb%3Dc%23d.jpg");
  });
});

describe("extractKeyFromUrl", () => {
  it("returns the key for an encoded url, whatever the characters in the filename", () => {
    const key = "medias/my folder/uuid-é #1 100%?.jpg";

    expect(extractKeyFromUrl(publicUrlFor(PUBLIC_URL, key), PUBLIC_URL)).toBe(key);
  });

  it("returns null for a malformed percent escape instead of throwing", () => {
    expect(extractKeyFromUrl(`${PUBLIC_URL}/medias/100%.jpg`, PUBLIC_URL)).toBeNull();
  });
});
