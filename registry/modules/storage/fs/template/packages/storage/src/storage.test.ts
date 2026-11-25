import { describe, it, expect } from "vite-plus/test";
import {
  detectImageType,
  extractKeyFromUrl,
  generateKey,
  publicUrlFor,
  R2Error,
  validateFile,
  validateKey,
} from "./storage";

const PUBLIC_URL = "https://media.example.com";

/** The first bytes of each allowed type, then some filler: what a real file starts with. */
const SIGNATURES = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/gif": [..."GIF89a"].map((char) => char.charCodeAt(0)),
  "image/webp": [..."RIFF\0\0\0\0WEBP"].map((char) => char.charCodeAt(0)),
} as const;

const fileOf = (bytes: readonly number[], type: string) =>
  new File([new Uint8Array([...bytes, 0, 0, 0, 0])], "photo", { type });

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

describe("detectImageType", () => {
  it("reads the type of each allowed image from its first bytes", () => {
    for (const [type, bytes] of Object.entries(SIGNATURES)) {
      expect([type, detectImageType(new Uint8Array(bytes))]).toEqual([type, type]);
    }
  });

  it("reads GIF87a as a gif too", () => {
    expect(detectImageType(new Uint8Array([..."GIF87a"].map((char) => char.charCodeAt(0))))).toBe(
      "image/gif",
    );
  });

  it("returns null for text, an empty file, and a RIFF file that is not WebP", () => {
    const riffWave = [..."RIFF\0\0\0\0WAVE"].map((char) => char.charCodeAt(0));

    expect(detectImageType(new TextEncoder().encode("hello, not an image"))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
    expect(detectImageType(new Uint8Array(riffWave))).toBeNull();
  });
});

describe("validateFile", () => {
  it("returns the detected type of a file that is what it says", async () => {
    for (const [type, bytes] of Object.entries(SIGNATURES)) {
      expect([type, await validateFile(fileOf(bytes, type))]).toEqual([type, type]);
    }
  });

  it("refuses a text file declared image/png with INVALID_FILE_TYPE", async () => {
    const file = new File(["just some text"], "fake.png", { type: "image/png" });

    await expect(validateFile(file)).rejects.toMatchObject({
      name: "R2Error",
      code: "INVALID_FILE_TYPE",
    });
  });

  it("refuses a real PNG declared image/jpeg", async () => {
    await expect(validateFile(fileOf(SIGNATURES["image/png"], "image/jpeg"))).rejects.toMatchObject(
      { code: "INVALID_FILE_TYPE" },
    );
  });

  it("refuses a real image with no declared type or a type that is not an image", async () => {
    for (const type of ["", "application/octet-stream", "text/plain"]) {
      await expect(validateFile(fileOf(SIGNATURES["image/png"], type))).rejects.toMatchObject({
        code: "INVALID_FILE_TYPE",
      });
    }
  });

  it("refuses an empty file", async () => {
    await expect(
      validateFile(new File([], "empty.png", { type: "image/png" })),
    ).rejects.toMatchObject({ code: "INVALID_FILE_TYPE" });
  });

  it("refuses a file over 10 MB with FILE_TOO_LARGE", async () => {
    const large = new File([new Uint8Array(11 * 1024 * 1024)], "large.jpg", { type: "image/jpeg" });

    await expect(validateFile(large)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});

describe("generateKey", () => {
  it("is medias/<folder>/<uuid>.<ext>, the extension from the type", () => {
    const keys = {
      "image/jpeg": generateKey("nodes/123", "image/jpeg"),
      "image/png": generateKey("nodes/123", "image/png"),
      "image/gif": generateKey("nodes/123", "image/gif"),
      "image/webp": generateKey("nodes/123", "image/webp"),
    };

    expect(keys["image/jpeg"]).toMatch(/^medias\/nodes\/123\/[0-9a-f-]{36}\.jpg$/);
    expect(keys["image/png"]).toMatch(/\.png$/);
    expect(keys["image/gif"]).toMatch(/\.gif$/);
    expect(keys["image/webp"]).toMatch(/\.webp$/);
  });

  it("is random: two keys of the same folder differ", () => {
    expect(generateKey("a", "image/png")).not.toBe(generateKey("a", "image/png"));
  });

  it("trims the slashes around the folder", () => {
    expect(generateKey("/test/folder/", "image/png")).toMatch(
      /^medias\/test\/folder\/[0-9a-f-]{36}\.png$/,
    );
  });

  it("rejects a folder that traverses upward", () => {
    expect(() => generateKey("../secret", "image/jpeg")).toThrow(R2Error);
    expect(() => generateKey("nodes/../../secret", "image/jpeg")).toThrow(R2Error);
  });

  it("rejects an empty folder and empty folder segments", () => {
    expect(() => generateKey("", "image/jpeg")).toThrow(R2Error);
    expect(() => generateKey("/", "image/jpeg")).toThrow(R2Error);
    expect(() => generateKey("nodes//123", "image/jpeg")).toThrow(R2Error);
  });

  it("rejects a folder containing control characters", () => {
    expect(() => generateKey("nodes\n123", "image/jpeg")).toThrow(R2Error);
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
