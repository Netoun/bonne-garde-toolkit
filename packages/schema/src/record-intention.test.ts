import { describe, expect, test } from "bun:test";
import {
  parseProjectManifest,
  ProjectManifestError,
  recordIntention,
  type ProjectManifest,
} from "./project-manifest";

const MODULE_RECORD = {
  id: "better-auth",
  variant: "default",
  version: "0.2.0",
  installedAt: "2026-01-01T00:00:00.000Z",
  options: {},
  patches: [],
  intentions: { applied: ["auth/better-auth/create-session-table"], skipped: {} },
};

function manifest(overrides: Record<string, unknown> = {}): ProjectManifest {
  return parseProjectManifest({
    version: 2,
    scope: "@acme",
    platform: {
      version: "0.1.0",
      remote: "github:owner/repo",
      intentions: { applied: ["v0.1.0/earlier"], skipped: {} },
    },
    registries: {},
    apps: [],
    modules: { auth: [MODULE_RECORD] },
    items: {},
    files: {},
    regions: {},
    ...overrides,
  });
}

describe("recordIntention: where an id lands", () => {
  test("a release id is applied under platform.intentions", () => {
    const before = manifest();
    const { manifest: after, recordedIn } = recordIntention(before, "v0.2.0/align-bun-pin", {
      status: "applied",
    });
    expect(recordedIn).toBe("platform");
    expect(after.platform.intentions).toEqual({
      applied: ["v0.1.0/earlier", "v0.2.0/align-bun-pin"],
      skipped: {},
    });
    expect(after.modules).toEqual(before.modules);
  });

  test("a release id is skipped with its reason", () => {
    const { manifest: after } = recordIntention(manifest(), "v0.2.0/adopt-x", {
      status: "skipped",
      reason: "capability not installed",
    });
    expect(after.platform.intentions.skipped).toEqual({
      "v0.2.0/adopt-x": "capability not installed",
    });
    expect(after.platform.intentions.applied).toEqual(["v0.1.0/earlier"]);
  });

  test("a module id lands on that module's record, not on the platform", () => {
    const before = manifest();
    const { manifest: after, recordedIn } = recordIntention(
      before,
      "auth/better-auth/wire-auth-into-api",
      { status: "applied" },
    );
    expect(recordedIn).toBe("auth/better-auth");
    expect(after.modules.auth?.[0]?.intentions.applied).toEqual([
      "auth/better-auth/create-session-table",
      "auth/better-auth/wire-auth-into-api",
    ]);
    expect(after.platform).toEqual(before.platform);
  });

  test("a module id lands on the skipped map of its module too", () => {
    const { manifest: after } = recordIntention(manifest(), "auth/better-auth/wire-auth-into-api", {
      status: "skipped",
      reason: "no api app yet",
    });
    expect(after.modules.auth?.[0]?.intentions.skipped).toEqual({
      "auth/better-auth/wire-auth-into-api": "no api app yet",
    });
  });
});

describe("recordIntention: an id is in exactly one list", () => {
  test("recording the same id applied twice does not duplicate it", () => {
    const once = recordIntention(manifest(), "v0.2.0/align-bun-pin", { status: "applied" });
    const twice = recordIntention(once.manifest, "v0.2.0/align-bun-pin", { status: "applied" });
    expect(twice.manifest).toEqual(once.manifest);
  });

  test("skipping an applied id moves it, and applying a skipped id moves it back", () => {
    const applied = recordIntention(manifest(), "v0.2.0/x", { status: "applied" }).manifest;
    const skipped = recordIntention(applied, "v0.2.0/x", {
      status: "skipped",
      reason: "changed my mind",
    }).manifest;
    expect(skipped.platform.intentions.applied).not.toContain("v0.2.0/x");
    expect(skipped.platform.intentions.skipped).toEqual({ "v0.2.0/x": "changed my mind" });

    const back = recordIntention(skipped, "v0.2.0/x", { status: "applied" }).manifest;
    expect(back.platform.intentions.applied).toContain("v0.2.0/x");
    expect(back.platform.intentions.skipped).toEqual({});
  });
});

describe("recordIntention: what it refuses", () => {
  test("an id that is neither a release id nor a module id", () => {
    for (const id of ["align-bun-pin", "v0.2/x", "0.2.0/x", "auth/better-auth", "V0.2.0/x"]) {
      expect(() => recordIntention(manifest(), id, { status: "applied" })).toThrow(
        ProjectManifestError,
      );
    }
    expect(() => recordIntention(manifest(), "align-bun-pin", { status: "applied" })).toThrow(
      /canonical intention id/,
    );
  });

  test("a module id whose category is unknown", () => {
    expect(() => recordIntention(manifest(), "nope/x/y", { status: "applied" })).toThrow(
      /unknown category/,
    );
  });

  test("a module id whose module is not installed", () => {
    expect(() =>
      recordIntention(manifest(), "auth/other-auth/wire", { status: "applied" }),
    ).toThrow(/auth\/other-auth is not installed/);
    expect(() => recordIntention(manifest(), "email/resend/wire", { status: "applied" })).toThrow(
      /email\/resend is not installed/,
    );
  });

  test("a skip without a reason", () => {
    expect(() =>
      recordIntention(manifest(), "v0.2.0/x", { status: "skipped", reason: "" }),
    ).toThrow(/reason/);
  });
});

describe("recordIntention: purity", () => {
  test("leaves the manifest it was given untouched", () => {
    const before = manifest();
    const snapshot = JSON.stringify(before);
    recordIntention(before, "v0.2.0/x", { status: "applied" });
    recordIntention(before, "auth/better-auth/wire", { status: "applied" });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test("returns a manifest the strict parser accepts", () => {
    const { manifest: after } = recordIntention(manifest(), "v0.2.0/x", {
      status: "skipped",
      reason: "not for this project",
    });
    expect(parseProjectManifest(JSON.parse(JSON.stringify(after)) as unknown)).toEqual(after);
  });
});
