import { describe, it, expect } from "bun:test";
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

  it("keeps a value the runtime holds, whatever the environment", () => {
    for (const nodeEnv of ["test", "development", "production", undefined]) {
      expect(
        resolveStorageEnv({ R2_PUBLIC_URL: "https://media.example.com" }, { nodeEnv })
          .R2_PUBLIC_URL,
      ).toBe("https://media.example.com");
    }
  });

  describe("under test", () => {
    it("fills the local media route, and only under test", () => {
      expect(resolveStorageEnv({}, { nodeEnv: "test" }).R2_PUBLIC_URL).toBe(
        "http://localhost:5172/v1/media/file",
      );
      expect(() => resolveStorageEnv({}, { nodeEnv: "production" })).toThrow();
    });

    it("does not read the API's origin, so a test does not depend on the shell it runs in", () => {
      expect(
        resolveStorageEnv({ API_URL: "https://api.example.com" }, { nodeEnv: "test" })
          .R2_PUBLIC_URL,
      ).toBe("http://localhost:5172/v1/media/file");
    });
  });

  describe("in development, where the launcher gives the API its origin and nothing has to tell the module", () => {
    it("serves the files under the media route of the API's own origin", () => {
      expect(
        resolveStorageEnv({ API_URL: "https://api.acme.localhost" }, { nodeEnv: "development" }),
      ).toEqual({ R2_PUBLIC_URL: "https://api.acme.localhost/v1/media/file" });
    });

    it("follows the API's origin when it moves, and a trailing slash does not double", () => {
      expect(
        resolveStorageEnv({ API_URL: "http://localhost:8787/" }, { nodeEnv: "development" })
          .R2_PUBLIC_URL,
      ).toBe("http://localhost:8787/v1/media/file");
    });

    it("takes an empty public url for an unset one", () => {
      expect(
        resolveStorageEnv(
          { R2_PUBLIC_URL: "", API_URL: "https://api.acme.localhost" },
          { nodeEnv: "development" },
        ).R2_PUBLIC_URL,
      ).toBe("https://api.acme.localhost/v1/media/file");
    });

    it("falls back to the local API, where the shell's own config puts it, when it has no origin either", () => {
      for (const source of [{}, { API_URL: "" }, { API_URL: 5172 }]) {
        expect(resolveStorageEnv(source, { nodeEnv: "development" }).R2_PUBLIC_URL).toBe(
          "http://localhost:5172/v1/media/file",
        );
      }
    });
  });

  describe("anywhere else, a deployed Worker included", () => {
    // wrangler inlines NODE_ENV as "production" in what it deploys and "development" under
    // `wrangler dev`. Only the second is a place a default is safe, and an unknown value is not
    // taken for it: a media url is stored, so a wrong one outlives the deploy that wrote it.
    it("fails naming the key, whatever origin the API has", () => {
      for (const nodeEnv of ["production", "staging", "", undefined]) {
        expect(() => resolveStorageEnv({ API_URL: "https://api.acme.com" }, { nodeEnv })).toThrow(
          /Missing required environment variables: R2_PUBLIC_URL/,
        );
      }
    });
  });
});
