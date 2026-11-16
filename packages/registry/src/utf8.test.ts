import { describe, expect, test } from "bun:test";
import { utf8Text } from "./utf8";

describe("utf8Text", () => {
  test("decodes valid UTF-8, multi-byte characters and a byte order mark included", () => {
    expect(utf8Text(Buffer.from("héllo ✓\n"))).toBe("héllo ✓\n");
    expect(utf8Text(Buffer.from("﻿a"))).toBe("﻿a");
    expect(utf8Text(new Uint8Array())).toBe("");
  });

  test("is null for bytes that are not UTF-8: a lone continuation byte, a truncated sequence, a PNG signature", () => {
    expect(utf8Text(Uint8Array.from([0x80]))).toBeNull();
    expect(utf8Text(Uint8Array.from([0xe2, 0x9c]))).toBeNull();
    expect(utf8Text(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});
