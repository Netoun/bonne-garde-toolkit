import { describe, expect, it } from "vite-plus/test";
import { TEST_SECRET, resolveMediaSecret, resolvePublicUrl } from "./env";

describe("resolvePublicUrl", () => {
  it("serves the files under APP_URL, the origin the provider owns", () => {
    expect(resolvePublicUrl({ APP_URL: "https://app.acme.com" })).toBe(
      "https://app.acme.com/v1/media/file",
    );
  });

  it("drops the trailing slashes of the origin", () => {
    expect(resolvePublicUrl({ APP_URL: "https://app.acme.com//" })).toBe(
      "https://app.acme.com/v1/media/file",
    );
  });

  it("falls back on the API_URL the provider derives from APP_URL, and a blank APP_URL counts as unset", () => {
    expect(resolvePublicUrl({ APP_URL: "", API_URL: "http://localhost:8080" })).toBe(
      "http://localhost:8080/v1/media/file",
    );
  });

  it("falls back on the local origin of the provider when the record holds neither", () => {
    expect(resolvePublicUrl({})).toBe("http://localhost:5172/v1/media/file");
  });
});

describe("resolveMediaSecret", () => {
  it("is the BETTER_AUTH_SECRET of the record, which auth owns", () => {
    expect(resolveMediaSecret({ BETTER_AUTH_SECRET: "s3cret-of-the-project" })).toBe(
      "s3cret-of-the-project",
    );
  });

  it("fails naming the key when it is missing or blank", () => {
    for (const source of [{}, { BETTER_AUTH_SECRET: "" }, { BETTER_AUTH_SECRET: 1 }]) {
      expect(() => resolveMediaSecret(source)).toThrow(
        /Missing required environment variables: BETTER_AUTH_SECRET/,
      );
    }
  });

  it("gets a fixture under test, and keeps the secret it is given", () => {
    expect(resolveMediaSecret({}, { nodeEnv: "test" })).toBe(TEST_SECRET);
    expect(resolveMediaSecret({ BETTER_AUTH_SECRET: "real" }, { nodeEnv: "test" })).toBe("real");
  });
});
