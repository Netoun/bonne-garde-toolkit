import { describe, it, expect } from "bun:test";
import { config, resolveAppConfig } from "./app.config";

const complete = {
  R2_PUBLIC_URL: "https://media.example.test",
  BETTER_AUTH_SECRET: "a-secret-that-is-at-least-32-chars!!",
  RESEND_API_KEY: "re_example",
};

describe("resolveAppConfig", () => {
  it("leaves the source record untouched", () => {
    const source = { ...complete };

    resolveAppConfig(source);

    expect(source).toEqual(complete);
  });

  it("applies the schema defaults for the three urls", () => {
    const resolved = resolveAppConfig({ ...complete });

    expect(resolved.SPA_URL).toBe("http://localhost:5173");
    expect(resolved.SSR_URL).toBe("http://localhost:5174");
    expect(resolved.API_URL).toBe("http://localhost:5172");
  });

  it("keeps a provided value instead of the default", () => {
    const resolved = resolveAppConfig({ ...complete, SPA_URL: "https://app.example.test" });

    expect(resolved.SPA_URL).toBe("https://app.example.test");
  });

  it("names every missing required var when it throws", () => {
    expect(() => resolveAppConfig({})).toThrow(/R2_PUBLIC_URL.*BETTER_AUTH_SECRET.*RESEND_API_KEY/);
  });

  it("treats an empty string as missing", () => {
    expect(() => resolveAppConfig({ ...complete, RESEND_API_KEY: "" })).toThrow(/RESEND_API_KEY/);
  });

  it("fills the secrets with fixtures in test mode instead of throwing", () => {
    const resolved = resolveAppConfig({}, { test: true });

    expect(resolved.R2_PUBLIC_URL).toBeTruthy();
    expect(resolved.BETTER_AUTH_SECRET).toBeTruthy();
    expect(resolved.RESEND_API_KEY).toBeTruthy();
  });

  it("does not overwrite a provided secret in test mode", () => {
    const resolved = resolveAppConfig({ RESEND_API_KEY: "re_mine" }, { test: true });

    expect(resolved.RESEND_API_KEY).toBe("re_mine");
  });
});

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
