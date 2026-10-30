import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

describe("parseModuleManifest, the fields `bg add` acts on", () => {
  const variant = (extra: Record<string, unknown>) => ({
    ...valid,
    variants: [{ key: "default", match: {}, ...extra }],
  });

  it("keeps a variant's patch entries, so an installer can refuse them instead of losing them", () => {
    const manifest = parseModuleManifest(
      variant({ patch: [{ type: "ts.elysiaUse", file: "apps/api/src/app.ts", argument: "x" }] }),
    );

    expect(manifest.variants[0]?.patch).toEqual([
      { type: "ts.elysiaUse", file: "apps/api/src/app.ts", argument: "x" },
    ]);
  });

  it("keeps the `intent` of a patch, the sentence a failed patch carries into its pending intention, and rejects one that is not text", () => {
    const manifest = parseModuleManifest(
      variant({
        patch: [
          { type: "ts.elysiaUse", file: "a.ts", intent: "Register the auth plugin on the API" },
        ],
      }),
    );

    expect(manifest.variants[0]?.patch?.[0]?.intent).toBe("Register the auth plugin on the API");
    for (const intent of ["", 3]) {
      expect(() =>
        parseModuleManifest(variant({ patch: [{ type: "ts.elysiaUse", intent }] })),
      ).toThrow(/patch\[0\]\.intent must be a non-empty string/);
    }
  });

  it("rejects a patch with no type, and a patch that is not a list", () => {
    expect(() => parseModuleManifest(variant({ patch: [{ file: "a.ts" }] }))).toThrow(
      /patch\[0\]\.type is required/,
    );
    expect(() => parseModuleManifest(variant({ patch: "ts.elysiaUse" }))).toThrow(
      /patch must be an array/,
    );
  });

  it("keeps a variant's workspace", () => {
    const manifest = parseModuleManifest(
      variant({ workspace: { name: "{{SCOPE}}/auth", path: "packages/auth" } }),
    );

    expect(manifest.variants[0]?.workspace).toEqual({
      name: "{{SCOPE}}/auth",
      path: "packages/auth",
    });
  });

  it("rejects a workspace whose path leaves the repository", () => {
    for (const path of ["../auth", "/abs/auth", "packages/../../auth"]) {
      expect(() => parseModuleManifest(variant({ workspace: { name: "x", path } }))).toThrow(
        /workspace\.path must be a repo-relative path/,
      );
    }
    expect(() => parseModuleManifest(variant({ workspace: { path: "packages/x" } }))).toThrow(
      /workspace\.name is required/,
    );
  });

  it("rejects a copy glob that is absolute or climbs out of template/", () => {
    for (const glob of ["../secrets", "/etc/passwd", "a/../../b"]) {
      expect(() => parseModuleManifest(variant({ copy: [glob] }))).toThrow(
        /copy\[0\] must be a path relative to template\//,
      );
    }
    expect(
      parseModuleManifest(variant({ copy: ["packages/auth/**", ".dockerignore"] })),
    ).toBeTruthy();
  });

  it("keeps module options with their defaults", () => {
    const manifest = parseModuleManifest({
      ...valid,
      options: {
        withOrg: { description: "Organization primitives", default: false, values: [true, false] },
        region: { default: "eu" },
      },
    });

    expect(manifest.options).toEqual({
      withOrg: { description: "Organization primitives", default: false, values: [true, false] },
      region: { default: "eu" },
    });
  });

  it("requires every option to have a default, one of its values", () => {
    expect(() => parseModuleManifest({ ...valid, options: { a: { values: [1, 2] } } })).toThrow(
      /options\.a\.default is required/,
    );
    expect(() =>
      parseModuleManifest({ ...valid, options: { a: { default: 3, values: [1, 2] } } }),
    ).toThrow(/options\.a\.default must be one of its values/);
    expect(() => parseModuleManifest({ ...valid, options: { a: { default: {} } } })).toThrow(
      /options\.a\.default must be a string, number or boolean/,
    );
  });

  it("keeps the checks a module declares", () => {
    expect(parseModuleManifest({ ...valid, checks: ["bun run typecheck"] }).checks).toEqual([
      "bun run typecheck",
    ]);
    expect(() => parseModuleManifest({ ...valid, checks: "bun run typecheck" })).toThrow(
      /checks must be an array of strings/,
    );
  });
});

describe("the category table", () => {
  it("puts provider first, so everything may peer on it", () => {
    expect(MODULE_CATEGORIES[0]).toBe("provider");
  });

  it("agrees with spec 035 on cardinality", () => {
    expect(categoryCardinality("provider")).toBe("one");
    expect(categoryCardinality("config")).toBe("one");
    expect(categoryCardinality("api")).toBe("one");
    expect(categoryCardinality("web")).toBe("many");
    expect(categoryCardinality("deploy")).toBe("many");
    expect(categoryCardinality("dev")).toBe("many");
  });

  it("is spec 035's table, in its order: config right after tooling, dev last", () => {
    expect([...MODULE_CATEGORIES]).toEqual([
      "provider",
      "tooling",
      "config",
      "api",
      "db",
      "orm",
      "auth",
      "ui",
      "email",
      "queue",
      "storage",
      "payments",
      "web",
      "testing",
      "deploy",
      "dev",
    ]);
  });

  it("is the same list project.schema.json allows as a key of `modules`", async () => {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null;
    const schema: unknown = JSON.parse(
      await readFile(join(import.meta.dir, "../project.schema.json"), "utf8"),
    );
    const modules =
      isRecord(schema) && isRecord(schema.properties) ? schema.properties.modules : null;
    const names =
      isRecord(modules) && isRecord(modules.propertyNames) ? modules.propertyNames.enum : null;

    expect(names).toEqual([...MODULE_CATEGORIES]);
  });
});
