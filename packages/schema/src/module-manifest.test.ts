import { describe, it, expect } from "bun:test";
import {
  MODULE_CATEGORIES,
  ModuleManifestError,
  categoryCardinality,
  parseModuleManifest,
} from "./module-manifest";

const valid = {
  id: "cloudflare",
  category: "provider",
  title: "Cloudflare",
  description: "Workers runtime, D1 and R2 bindings, wrangler deploys.",
  variants: [{ key: "default", match: {} }],
};

describe("parseModuleManifest", () => {
  it("accepts a minimal manifest and defaults peers to empty", () => {
    const manifest = parseModuleManifest({ ...valid });

    expect(manifest.id).toBe("cloudflare");
    expect(manifest.category).toBe("provider");
    expect(manifest.peers).toEqual({});
    expect(manifest.variants).toHaveLength(1);
  });

  it("rejects an unknown category and names the allowed ones", () => {
    expect(() => parseModuleManifest({ ...valid, category: "runtime" })).toThrow(
      /category must be one of .*provider.*got: runtime/s,
    );
  });

  it("rejects an unknown category inside peers", () => {
    expect(() => parseModuleManifest({ ...valid, peers: { runtime: ["x"] } })).toThrow(
      /peers has an unknown category: runtime/,
    );
  });

  it("rejects an unknown category inside a variant match", () => {
    expect(() =>
      parseModuleManifest({
        ...valid,
        variants: [{ key: "default", match: { runtime: "cloudflare" } }],
      }),
    ).toThrow(/unknown category: runtime/);
  });

  it("rejects two variants with the same match set", () => {
    expect(() =>
      parseModuleManifest({
        ...valid,
        variants: [
          { key: "a", match: { provider: "cloudflare" } },
          { key: "b", match: { provider: "cloudflare" } },
        ],
      }),
    ).toThrow(/ambiguous match set/);
  });

  it("catches an ambiguous match set written in a different key order", () => {
    expect(() =>
      parseModuleManifest({
        ...valid,
        variants: [
          { key: "a", match: { provider: "dockerfile", orm: "drizzle" } },
          { key: "b", match: { orm: "drizzle", provider: "dockerfile" } },
        ],
      }),
    ).toThrow(/ambiguous match set/);
  });

  it("rejects two default variants", () => {
    expect(() =>
      parseModuleManifest({
        ...valid,
        variants: [{ key: "a", match: {} }, { key: "b" }],
      }),
    ).toThrow(/ambiguous match set/);
  });

  it("allows variants that differ in specificity", () => {
    const manifest = parseModuleManifest({
      ...valid,
      variants: [
        { key: "default", match: {} },
        { key: "with-drizzle", match: { orm: "drizzle" } },
      ],
    });

    expect(manifest.variants.map((v) => v.key)).toEqual(["default", "with-drizzle"]);
  });

  it("rejects a duplicate variant key", () => {
    expect(() =>
      parseModuleManifest({
        ...valid,
        variants: [
          { key: "same", match: {} },
          { key: "same", match: { orm: "drizzle" } },
        ],
      }),
    ).toThrow(/duplicate key: same/);
  });

  it("requires at least one variant", () => {
    expect(() => parseModuleManifest({ ...valid, variants: [] })).toThrow(
      /variants must be a non-empty array/,
    );
  });

  it("rejects a non-kebab-case id", () => {
    expect(() => parseModuleManifest({ ...valid, id: "Cloudflare" })).toThrow(/kebab-case/);
  });

  it("throws ModuleManifestError, not a bare Error", () => {
    expect(() => parseModuleManifest(null)).toThrow(ModuleManifestError);
  });

  it("keeps version informational but typed", () => {
    expect(parseModuleManifest({ ...valid, version: "0.2.0" }).version).toBe("0.2.0");
    expect(() => parseModuleManifest({ ...valid, version: 2 })).toThrow(/version must be a string/);
  });
});

describe("the category table", () => {
  it("puts provider first, so everything may peer on it", () => {
    expect(MODULE_CATEGORIES[0]).toBe("provider");
  });

  it("agrees with spec 035 on cardinality", () => {
    expect(categoryCardinality("provider")).toBe("one");
    expect(categoryCardinality("api")).toBe("one");
    expect(categoryCardinality("web")).toBe("many");
    expect(categoryCardinality("deploy")).toBe("many");
  });
});
