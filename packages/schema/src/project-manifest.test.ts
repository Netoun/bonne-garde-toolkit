import { describe, expect, test } from "bun:test";
import {
  createEmptyProjectManifest,
  parseProjectManifest,
  ProjectManifestError,
} from "./project-manifest";

describe("parseProjectManifest", () => {
  test("accepts a valid empty manifest with platform", () => {
    const manifest = createEmptyProjectManifest({
      scope: "@acme",
      registries: { "@bg": "local:./registry" },
      platformVersion: "0.1.0",
      platformRemote: "github:Netoun/bonne-garde-boilerplate",
    });
    expect(manifest.platform).toEqual({
      version: "0.1.0",
      remote: "github:Netoun/bonne-garde-boilerplate",
      intentions: { applied: [], skipped: {} },
    });
    expect(parseProjectManifest(manifest)).toEqual(manifest);
  });

  test("rejects platform.version with leading v", () => {
    expect(() =>
      parseProjectManifest({
        version: 1,
        scope: "@acme",
        platform: {
          version: "v0.1.0",
          remote: "github:owner/repo",
          intentions: { applied: [], skipped: {} },
        },
        registries: {},
        installed: {},
      }),
    ).toThrow(/platform\.version/);
  });

  test("rejects invalid intention id in applied", () => {
    expect(() =>
      parseProjectManifest({
        version: 1,
        scope: "@acme",
        platform: {
          version: "0.1.0",
          remote: "github:owner/repo",
          intentions: { applied: ["align-bun-pin"], skipped: {} },
        },
        registries: {},
        installed: {},
      }),
    ).toThrow(/intention/);
  });

  test("rejects invalid scope", () => {
    expect(() =>
      parseProjectManifest({
        version: 1,
        scope: "acme",
        platform: {
          version: "0.0.0",
          remote: "github:owner/repo",
          intentions: { applied: [], skipped: {} },
        },
        registries: {},
        installed: {},
      }),
    ).toThrow(ProjectManifestError);
  });

  test("rejects unknown schema version", () => {
    expect(() =>
      parseProjectManifest({
        version: 2,
        scope: "@acme",
        platform: {
          version: "0.0.0",
          remote: "github:owner/repo",
          intentions: { applied: [], skipped: {} },
        },
        registries: {},
        installed: {},
      }),
    ).toThrow(/version/);
  });
});
