import { describe, it, expect } from "bun:test";
import { resolveAuthEnv } from "./env";

describe("resolveAuthEnv", () => {
  it("returns the secret the runtime holds", () => {
    expect(resolveAuthEnv({ BETTER_AUTH_SECRET: "s".repeat(32) })).toEqual({
      BETTER_AUTH_SECRET: "s".repeat(32),
    });
  });

  it("names BETTER_AUTH_SECRET when it is missing or empty", () => {
    for (const source of [{}, { BETTER_AUTH_SECRET: "" }, { BETTER_AUTH_SECRET: 42 }]) {
      expect(() => resolveAuthEnv(source)).toThrow(
        /Missing required environment variables: BETTER_AUTH_SECRET/,
      );
    }
  });

  it("fills a fixture under test, and only under test", () => {
    expect(resolveAuthEnv({}, { test: true }).BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(32);
    expect(() => resolveAuthEnv({}, { test: false })).toThrow();
  });
});
