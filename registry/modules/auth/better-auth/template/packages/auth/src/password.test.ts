import { describe, it, expect } from "bun:test";
import { scryptSync } from "node:crypto";
import { hashPassword, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("verifies the password it hashed", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");

    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("stores `<32 hex salt>:<128 hex scrypt key>`", async () => {
    const hash = await hashPassword("password123");

    expect(hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it("derives the key with scrypt over the hex salt string, 64 bytes", async () => {
    const hash = await hashPassword("password123");
    const [salt, key] = hash.split(":");

    expect(scryptSync("password123", salt ?? "", 64).toString("hex")).toBe(key ?? "");
  });

  it("salts each hash so the same password never hashes twice the same", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);

    expect(first).not.toBe(second);
    expect(await verifyPassword("same", first)).toBe(true);
    expect(await verifyPassword("same", second)).toBe(true);
  });
});
