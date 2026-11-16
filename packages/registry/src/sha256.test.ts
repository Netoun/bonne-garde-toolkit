import { describe, expect, test } from "bun:test";
import { sha256Hex } from "./sha256";

describe("sha256Hex", () => {
  test("hashes a string and the bytes of the same string alike", () => {
    // sha256("abc"), from FIPS 180-2 appendix B
    const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256Hex("abc")).toBe(abc);
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(abc);
  });

  test("hashes the utf-8 bytes of non-ascii text", () => {
    const text = "héllo — bonne garde\n";
    expect(sha256Hex(text)).toBe(sha256Hex(new TextEncoder().encode(text)));
  });
});
