import { describe, expect, test } from "bun:test";
import {
  createEmptyProjectManifest,
  parseProjectManifest,
  ProjectManifestError,
  readProjectManifest,
  type PlatformState,
} from "./project-manifest";

const SHA = "a".repeat(64);

function platform(): PlatformState {
  return {
    version: "0.1.0",
    remote: "github:owner/repo",
    intentions: { applied: [], skipped: {} },
  };
}

function v2(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    scope: "@acme",
    platform: platform(),
    registries: {},
    apps: [],
    modules: {},
    items: {},
    files: {},
    regions: {},
    ...overrides,
  };
}

function v1(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    scope: "@acme",
    platform: platform(),
    registries: { "@bg": "local:./registry" },
    installed: {
      button: { source: "@bg/button", version: "0.1.0", installedAt: "2026-01-01T00:00:00.000Z" },
    },
    capabilities: ["ui"],
    ...overrides,
  };
}

const MODULE_RECORD = {
  id: "better-auth",
  variant: "default",
  version: "0.2.0",
  installedAt: "2026-01-01T00:00:00.000Z",
  options: { withOrg: false },
  patches: [{ type: "ts.elysiaUse", file: "apps/api/src/app.ts", status: "applied" as const }],
  intentions: { applied: ["auth/better-auth/wire-auth-into-api"], skipped: {} },
};

describe("createEmptyProjectManifest", () => {
  test("is a v2 manifest with every collection empty", () => {
    const manifest = createEmptyProjectManifest({
      scope: "@acme",
      registries: { "@bg": "local:./registry" },
      platformVersion: "0.1.0",
      platformRemote: "github:Netoun/bonne-garde-toolkit",
    });
    expect(manifest).toEqual({
      version: 2,
      scope: "@acme",
      platform: {
        version: "0.1.0",
        remote: "github:Netoun/bonne-garde-toolkit",
        intentions: { applied: [], skipped: {} },
      },
      registries: { "@bg": "local:./registry" },
      apps: [],
      modules: {},
      items: {},
      files: {},
      regions: {},
    });
  });
});

describe("parseProjectManifest (v2)", () => {
  test("round-trips an empty manifest through JSON", () => {
    const manifest = createEmptyProjectManifest({
      scope: "@acme",
      registries: { "@bg": "local:./registry" },
    });
    expect(parseProjectManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  test("round-trips a populated manifest through JSON", () => {
    const input = v2({
      $schema: "./node_modules/create-bonne-garde/schema/project.json",
      registries: { "@bg": "github:Netoun/bonne-garde-toolkit@v0.2.0" },
      apps: [{ id: "api", dir: "apps/api", kind: "worker" }],
      modules: { auth: [MODULE_RECORD] },
      items: {
        button: { source: "@bg/button", version: "0.2.0", installedAt: "2026-01-01T00:00:00.000Z" },
      },
      files: {
        "packages/ui/src/components/button.tsx": { owner: "button", sha256: SHA },
        "packages/auth/src/index.ts": { owner: "auth/better-auth", sha256: SHA },
      },
      regions: {
        "package.json": { "workspaces[packages/auth]": "auth/better-auth" },
        "apps/api/src/app.ts": { "elysia[app].use[authModule]": "auth/better-auth" },
      },
    });
    const manifest = parseProjectManifest(input);
    expect(manifest.version).toBe(2);
    expect(manifest.modules.auth).toEqual([MODULE_RECORD]);
    expect(manifest.files["packages/auth/src/index.ts"]).toEqual({
      owner: "auth/better-auth",
      sha256: SHA,
    });
    expect(parseProjectManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
    // `$schema` leads the serialised form, as in spec 020's example.
    expect(Object.keys(manifest)[0]).toBe("$schema");
  });

  test("rejects platform.version with leading v", () => {
    expect(() =>
      parseProjectManifest(v2({ platform: { ...platform(), version: "v0.1.0" } })),
    ).toThrow(/platform\.version/);
  });

  test("rejects invalid intention id in applied", () => {
    expect(() =>
      parseProjectManifest(
        v2({
          platform: { ...platform(), intentions: { applied: ["align-bun-pin"], skipped: {} } },
        }),
      ),
    ).toThrow(/intention/);
  });

  test("rejects invalid scope", () => {
    expect(() => parseProjectManifest(v2({ scope: "acme" }))).toThrow(ProjectManifestError);
  });

  test("requires the v2 collections", () => {
    for (const field of ["apps", "modules", "items", "files", "regions"]) {
      const input = v2();
      delete input[field];
      expect(() => parseProjectManifest(input)).toThrow(new RegExp(field));
    }
  });

  test("rejects an app whose dir escapes the repository", () => {
    for (const dir of ["../outside", "/etc", "apps/../../x"]) {
      expect(() =>
        parseProjectManifest(v2({ apps: [{ id: "api", dir, kind: "worker" }] })),
      ).toThrow(/apps\[0\]\.dir/);
    }
  });

  test("rejects a files entry with a malformed sha256", () => {
    expect(() =>
      parseProjectManifest(v2({ files: { "a.ts": { owner: "button", sha256: "nope" } } })),
    ).toThrow(/sha256/);
  });

  test("rejects a files path that escapes the repository", () => {
    expect(() =>
      parseProjectManifest(v2({ files: { "../a.ts": { owner: "button", sha256: SHA } } })),
    ).toThrow(/files/);
  });

  test("rejects a module record under an unknown category", () => {
    expect(() => parseProjectManifest(v2({ modules: { nope: [MODULE_RECORD] } }))).toThrow(
      /unknown category/,
    );
  });

  test("fails closed when a cardinality-one category holds two records", () => {
    const other = { ...MODULE_RECORD, id: "other-auth" };
    expect(() => parseProjectManifest(v2({ modules: { auth: [MODULE_RECORD, other] } }))).toThrow(
      /auth.*at most one/,
    );
  });

  test("allows several records in a cardinality-many category", () => {
    const manifest = parseProjectManifest(
      v2({
        modules: {
          web: [
            { ...MODULE_RECORD, id: "spa" },
            { ...MODULE_RECORD, id: "ssr" },
          ],
        },
      }),
    );
    expect(manifest.modules.web?.map((record) => record.id)).toEqual(["spa", "ssr"]);
  });

  test("requires a reason on a failed patch and rejects an unknown status", () => {
    const withPatch = (patch: Record<string, unknown>) =>
      v2({ modules: { auth: [{ ...MODULE_RECORD, patches: [patch] }] } });
    expect(() =>
      parseProjectManifest(withPatch({ type: "ts.elysiaUse", file: "a.ts", status: "failed" })),
    ).toThrow(/reason/);
    expect(() =>
      parseProjectManifest(withPatch({ type: "ts.elysiaUse", file: "a.ts", status: "maybe" })),
    ).toThrow(/status/);
    expect(
      parseProjectManifest(
        withPatch({ type: "ts.elysiaUse", file: "a.ts", status: "failed", reason: "no seam" }),
      ).modules.auth?.[0]?.patches[0]?.reason,
    ).toBe("no seam");
  });

  test("a failed patch may name the intention that tracks it, a canonical one, and no other patch may", () => {
    const withPatch = (patch: Record<string, unknown>) =>
      v2({ modules: { auth: [{ ...MODULE_RECORD, patches: [patch] }] } });
    const failed = {
      type: "ts.elysiaUse",
      file: "a.ts",
      status: "failed" as const,
      reason: "no seam",
    };
    const id = "auth/better-auth/patch-ts-elysia-use-a-ts-elysia-app-use-auth-module";

    expect(
      parseProjectManifest(withPatch({ ...failed, intention: id })).modules.auth?.[0]?.patches[0],
    ).toEqual({ ...failed, intention: id });
    expect(() => parseProjectManifest(withPatch({ ...failed, intention: "v0.2.0/x" }))).toThrow(
      /intention must be a canonical intention id/,
    );
    expect(() =>
      parseProjectManifest(
        withPatch({ type: "ts.elysiaUse", file: "a.ts", status: "applied", intention: id }),
      ),
    ).toThrow(/intention is only recorded for a failed patch/);
  });

  test("rejects a module intention id that is not <category>/<module>/<slug>", () => {
    const bad = { ...MODULE_RECORD, intentions: { applied: ["v0.2.0/align"], skipped: {} } };
    expect(() => parseProjectManifest(v2({ modules: { auth: [bad] } }))).toThrow(/intention/);
  });

  test("does not read a v1 manifest", () => {
    expect(() => parseProjectManifest(v1())).toThrow(/readProjectManifest/);
  });
});

describe("unknown schema versions fail closed", () => {
  for (const version of [3, 0, "2", null, undefined]) {
    test(`version ${JSON.stringify(version) ?? "missing"}`, () => {
      const input = v2({ version });
      expect(() => parseProjectManifest(input)).toThrow(/unsupported bg\.json version/);
      expect(() => readProjectManifest(input)).toThrow(/unsupported bg\.json version/);
    });
  }
});

describe("readProjectManifest", () => {
  test("reads a v2 manifest as is, with no migration", () => {
    const read = readProjectManifest(v2());
    expect(read.migratedFrom).toBeNull();
    expect(read.manifest).toEqual(parseProjectManifest(v2()));
  });

  test("reads a v1 manifest and rewrites it as v2 with empty files and regions", () => {
    const read = readProjectManifest(v1());
    expect(read.migratedFrom).toBe(1);
    expect(read.manifest).toEqual({
      version: 2,
      scope: "@acme",
      platform: platform(),
      registries: { "@bg": "local:./registry" },
      apps: [],
      modules: {},
      items: {
        button: { source: "@bg/button", version: "0.1.0", installedAt: "2026-01-01T00:00:00.000Z" },
      },
      files: {},
      regions: {},
    });
    // The result is a valid v2 manifest, and `capabilities` did not survive.
    expect(parseProjectManifest(read.manifest)).toEqual(read.manifest);
    expect("capabilities" in read.manifest).toBe(false);
    expect("installed" in read.manifest).toBe(false);
  });

  test("keeps $schema when migrating", () => {
    const read = readProjectManifest(v1({ $schema: "./project.json" }));
    expect(read.manifest.$schema).toBe("./project.json");
  });

  test("still validates a v1 manifest", () => {
    expect(() =>
      readProjectManifest(v1({ installed: { button: { source: "@bg/button" } } })),
    ).toThrow(/installed\.button/);
    expect(() => readProjectManifest(v1({ capabilities: "ui" }))).toThrow(/capabilities/);
    expect(() => readProjectManifest(v1({ scope: "acme" }))).toThrow(ProjectManifestError);
  });
});
