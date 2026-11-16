import { describe, expect, test } from "bun:test";
import { resolveEmailEnv } from "./env";

describe("resolveEmailEnv", () => {
  test("reads the key out of the runtime's environment record", () => {
    expect(resolveEmailEnv({ RESEND_API_KEY: "re_live", OTHER: "x" })).toEqual({
      RESEND_API_KEY: "re_live",
    });
  });

  test.each([
    ["missing", {}],
    ["empty", { RESEND_API_KEY: "" }],
    ["not a string", { RESEND_API_KEY: 12 }],
  ])("a key that is %s fails, naming it and where to get one", (_what, source) => {
    expect(() => resolveEmailEnv(source)).toThrow(/RESEND_API_KEY.*resend\.com\/api-keys/s);
  });
});
