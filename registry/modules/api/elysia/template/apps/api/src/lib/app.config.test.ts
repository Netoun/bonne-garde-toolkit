import { describe, it, expect } from "bun:test";
import { config, resolveAppConfig } from "./app.config";

const provided = { API_URL: "https://api.example.test" };

describe("resolveAppConfig", () => {
  it("leaves the source record untouched", () => {
    const source = { ...provided };

    resolveAppConfig(source);

    expect(source).toEqual(provided);
  });

  it("applies the schema defaults for the three urls", () => {
    const resolved = resolveAppConfig({});

    expect(resolved.SPA_URL).toBe("http://localhost:5173");
    expect(resolved.SSR_URL).toBe("http://localhost:5174");
    expect(resolved.API_URL).toBe("http://localhost:5172");
  });

  it("keeps a provided value instead of the default", () => {
    const resolved = resolveAppConfig({ ...provided, SPA_URL: "https://app.example.test" });

    expect(resolved.SPA_URL).toBe("https://app.example.test");
    expect(resolved.API_URL).toBe(provided.API_URL);
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
});
