import { describe, it, expect } from "bun:test";
import { config } from "./app.config";

describe("config", () => {
  it("is a copy of the environment, not process.env itself", () => {
    expect(Object.is(config, process.env)).toBe(false);
  });

  it("does not write changes back into process.env", () => {
    const original = config.SPA_URL;
    const changed = "https://changed.example";

    config.SPA_URL = changed;
    try {
      expect(process.env.SPA_URL).not.toBe(changed);
    } finally {
      config.SPA_URL = original;
    }
  });

  it("fills the required values with test defaults when the environment lacks them", () => {
    expect(config.R2_PUBLIC_URL).toBeTruthy();
    expect(config.BETTER_AUTH_SECRET).toBeTruthy();
    expect(config.RESEND_API_KEY).toBeTruthy();
  });
});
