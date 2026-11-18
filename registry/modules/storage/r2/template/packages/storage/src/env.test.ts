import { describe, it, expect } from "vite-plus/test";
import { resolveStorageEnv } from "./env";

describe("resolveStorageEnv", () => {
  it("returns the public url the runtime holds", () => {
    expect(resolveStorageEnv({ R2_PUBLIC_URL: "https://media.example.com" })).toEqual({
      R2_PUBLIC_URL: "https://media.example.com",
    });
  });

  it("names R2_PUBLIC_URL when it is missing, empty or not a string", () => {
    for (const source of [{}, { R2_PUBLIC_URL: "" }, { R2_PUBLIC_URL: 42 }]) {
      expect(() => resolveStorageEnv(source)).toThrow(
        /Missing required environment variables: R2_PUBLIC_URL/,
      );
    }
  });

  it("fills the local media route under test, and only under test", () => {
    expect(resolveStorageEnv({}, { test: true }).R2_PUBLIC_URL).toBe(
      "http://localhost:5172/v1/media/file",
    );
    expect(() => resolveStorageEnv({}, { test: false })).toThrow();
  });

  it("keeps a value the runtime holds under test", () => {
    expect(
      resolveStorageEnv({ R2_PUBLIC_URL: "https://media.example.com" }, { test: true })
        .R2_PUBLIC_URL,
    ).toBe("https://media.example.com");
  });
});
