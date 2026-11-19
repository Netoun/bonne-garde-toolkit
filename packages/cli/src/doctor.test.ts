import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  parseProjectManifest,
  readProjectManifest,
  type ModuleRecord,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { addItems } from "./add";
import { createProject } from "./create";
import { doctorExitCode, formatDoctor, runDoctor, type DoctorReport } from "./doctor";
import { findRepoRoot } from "./paths";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function repoRegistry(): string {
  const root = findRepoRoot();
  if (!root) {
    throw new Error("repo root not found");
  }
  return `local:${join(root, "registry")}`;
}

async function scratch(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A project straight out of `bonne-garde create`, registry pointed at this repo's. */
async function emptyProject(registry = repoRegistry()): Promise<string> {
  return createProject({
    name: "doc-app",
    cwd: await scratch("bg-doctor-"),
    git: false,
    install: false,
    registry,
  }).then(({ target }) => target);
}

/** A project after one clean `bonne-garde add button`. */
async function projectWithButton(): Promise<string> {
  const root = await emptyProject();
  await addItems({ projectRoot: root, items: ["ui/shadcn", "button"], install: false });
  return root;
}

async function readManifest(root: string): Promise<ProjectManifest> {
  return readProjectManifest(JSON.parse(await readFile(join(root, "bg.json"), "utf8")) as unknown)
    .manifest;
}

/** Hand-written manifests stand in for what no real `add` produces yet: modules, regions, patches. */
async function editManifest(
  root: string,
  edit: (manifest: ProjectManifest) => ProjectManifest,
): Promise<void> {
  const next = parseProjectManifest(edit(await readManifest(root)));
  await writeFile(join(root, "bg.json"), `${JSON.stringify(next, null, 2)}\n`);
}

function moduleRecord(id: string, overrides: Partial<ModuleRecord> = {}): ModuleRecord {
  return {
    id,
    variant: "default",
    version: "0.0.0",
    installedAt: "2026-01-01T00:00:00.000Z",
    options: {},
    patches: [],
    intentions: { applied: [], skipped: {} },
    ...overrides,
  };
}

async function stage(root: string, where: string, file: string, id: string): Promise<void> {
  await mkdir(join(root, ".bg", where), { recursive: true });
  await writeFile(
    join(root, ".bg", where, file),
    `---\nid: ${id}\ndomain: tooling\nclassification: migration\n---\n\n# ${id}\n`,
  );
}

function codes(report: DoctorReport, check: keyof DoctorReport["checks"]): string[] {
  return report.checks[check].findings.map((finding) => finding.code);
}

const BUTTON = "packages/ui/src/components/button.tsx";

describe("runDoctor: the report", () => {
  test("covers the six checks, in order, and is plain JSON", async () => {
    const report = await runDoctor(await projectWithButton());
    expect(Object.keys(report.checks)).toEqual([
      "manifest",
      "files",
      "regions",
      "patches",
      "intentions",
      "peers",
    ]);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  test("is green right after a clean add, for --strict too", async () => {
    const report = await runDoctor(await projectWithButton());
    expect(report.status).toBe("ok");
    for (const check of Object.values(report.checks)) {
      expect(check.status).toBe("ok");
      expect(check.findings).toEqual([]);
    }
    expect(doctorExitCode(report, true)).toBe(0);
    expect(report.checks.manifest.details).toMatchObject({
      version: 2,
      modules: 1,
      items: 3,
      files: 9,
    });
    expect(report.checks.files.details).toMatchObject({ tracked: 9, intact: 9 });
  });

  test("is green on a project nothing was added to", async () => {
    const report = await runDoctor(await emptyProject());
    expect(report.status).toBe("ok");
  });
});

describe("runDoctor: files", () => {
  test("names a modified file as user-modified: a warning, so only --strict fails", async () => {
    const root = await projectWithButton();
    await writeFile(join(root, BUTTON), "// mine now\n");

    const report = await runDoctor(root);

    expect(codes(report, "files")).toEqual(["file-modified"]);
    expect(report.checks.files.findings[0]).toMatchObject({
      severity: "warning",
      path: BUTTON,
    });
    expect(report.checks.files.details).toMatchObject({ modified: [BUTTON], intact: 8 });
    expect(report.status).toBe("warning");
    expect(doctorExitCode(report, false)).toBe(0);
    expect(doctorExitCode(report, true)).toBe(1);
  });

  test("names a deleted file as missing: an error, so plain doctor fails too", async () => {
    const root = await projectWithButton();
    await unlink(join(root, BUTTON));

    const report = await runDoctor(root);

    expect(codes(report, "files")).toEqual(["file-missing"]);
    expect(report.checks.files.findings[0]).toMatchObject({ severity: "error", path: BUTTON });
    expect(report.checks.files.details).toMatchObject({ missing: [BUTTON] });
    expect(report.status).toBe("error");
    expect(doctorExitCode(report, false)).toBe(1);
    expect(doctorExitCode(report, true)).toBe(1);
  });

  test("a file the consumer added next to a vendored one is their code, not drift", async () => {
    const root = await projectWithButton();
    await writeFile(join(root, "packages/ui/src/components/mine.tsx"), "export const Mine = 1;\n");

    const report = await runDoctor(root);

    expect(report.status).toBe("ok");
    expect(report.checks.files.details).toMatchObject({ tracked: 9, untrackedButExpected: [] });
    expect(report.checks.files.notes.join(" ")).toMatch(/not checked/);
  });

  test("a recorded path that cannot be read is an error finding, not a crash", async () => {
    const root = await projectWithButton();
    await unlink(join(root, BUTTON));
    await mkdir(join(root, BUTTON));

    const report = await runDoctor(root);

    expect(codes(report, "files")).toEqual(["file-unreadable"]);
    expect(report.checks.files.findings[0]?.severity).toBe("error");
  });
});

describe("runDoctor: a file with recorded regions is checked by region, not by sha", () => {
  const SCRIPT = "tsx packages/config/scripts/gen-branding.ts";

  /** A project with `config/branding`, whose root package.json a patch edited. */
  async function brandingProject(): Promise<string> {
    const root = await emptyProject();
    await addItems({ projectRoot: root, items: ["config/branding"], install: false });
    return root;
  }

  /** Records the root package.json as a tier-1 file of the module, at the sha it had before the patch. */
  async function recordRootAsTierOne(root: string, sha256: string): Promise<void> {
    await editManifest(root, (m) => ({
      ...m,
      files: { ...m.files, "package.json": { owner: "config/branding", sha256 } },
    }));
  }

  test("a patched file whose sha no longer matches is not user-modified: its regions say what is true", async () => {
    const root = await brandingProject();
    await recordRootAsTierOne(root, "a".repeat(64));

    const report = await runDoctor(root);

    expect(codes(report, "files")).toEqual([]);
    expect(report.checks.files.details).toMatchObject({ byRegion: ["package.json"], modified: [] });
    expect(report.status).toBe("ok");
    expect(doctorExitCode(report, true)).toBe(0);
  });

  test("the same file without regions is user-modified", async () => {
    const root = await brandingProject();
    await recordRootAsTierOne(root, "a".repeat(64));
    await editManifest(root, (m) => ({ ...m, regions: {} }));

    const report = await runDoctor(root);

    expect(codes(report, "files")).toEqual(["file-modified"]);
  });

  test("a recorded file that is gone is still missing, regions or not", async () => {
    const root = await brandingProject();
    await recordRootAsTierOne(root, "a".repeat(64));
    await unlink(join(root, "package.json"));

    const report = await runDoctor(root);

    expect(codes(report, "files")).toEqual(["file-missing"]);
  });

  test("its regions are read: a script that was recorded and is still there is fine", async () => {
    const report = await runDoctor(await brandingProject());

    expect(report.checks.regions.status).toBe("ok");
    expect(report.checks.regions.details).toMatchObject({
      files: 1,
      regions: 1,
      checked: ["package.json#scripts.gen:branding"],
      missing: [],
      foreignEdit: [],
    });
  });

  test("a recorded script that was deleted is an error", async () => {
    const root = await brandingProject();
    const text = await readFile(join(root, "package.json"), "utf8");
    await writeFile(join(root, "package.json"), text.replace(/,\n\s*"gen:branding": "[^"]*"/, ""));

    const report = await runDoctor(root);

    expect(codes(report, "regions")).toEqual(["region-missing"]);
    expect(report.checks.regions.findings[0]).toMatchObject({
      severity: "error",
      path: "package.json",
    });
    expect(report.checks.regions.findings[0]?.message).toContain("scripts.gen:branding");
    expect(report.checks.regions.findings[0]?.message).toContain("config/branding");
    expect(report.checks.regions.details).toMatchObject({
      missing: ["package.json#scripts.gen:branding"],
    });
    expect(doctorExitCode(report, false)).toBe(1);
  });

  test("a recorded script someone edited is a foreign edit: a warning, so only --strict fails", async () => {
    const root = await brandingProject();
    const text = await readFile(join(root, "package.json"), "utf8");
    await writeFile(join(root, "package.json"), text.replace(SCRIPT, "bun mine.ts"));

    const report = await runDoctor(root);

    expect(codes(report, "regions")).toEqual(["region-foreign-edit"]);
    expect(report.checks.regions.findings[0]?.severity).toBe("warning");
    expect(report.checks.regions.findings[0]?.message).toContain('"bun mine.ts"');
    expect(report.checks.regions.findings[0]?.message).toContain(SCRIPT);
    expect(report.checks.regions.details).toMatchObject({
      foreignEdit: ["package.json#scripts.gen:branding"],
    });
    expect(doctorExitCode(report, false)).toBe(0);
    expect(doctorExitCode(report, true)).toBe(1);
  });

  test("a file that is not JSON cannot hold its recorded regions: an error", async () => {
    const root = await brandingProject();
    await writeFile(join(root, "package.json"), "{ nope");

    const report = await runDoctor(root);

    expect(codes(report, "regions")).toEqual(["region-file-invalid"]);
    expect(report.checks.regions.findings[0]?.severity).toBe("error");
  });

  test("a region that is a path in any JSON file is read, whichever patch wrote it", async () => {
    const root = await brandingProject();
    await editManifest(root, (m) => ({
      ...m,
      regions: {
        "package.json": {
          ...m.regions["package.json"],
          name: "config/branding",
          license: "config/branding",
          'scripts."gen.x"': "config/branding",
        },
      },
    }));

    const report = await runDoctor(root);

    expect(report.checks.regions.details).toMatchObject({
      checked: ["package.json#scripts.gen:branding", "package.json#name"],
      missing: ["package.json#license", 'package.json#scripts."gen.x"'],
      unchecked: [],
    });
    expect(codes(report, "regions")).toEqual(["region-missing", "region-missing"]);
  });

  test("with a registry doctor cannot read (offline: not a local path), presence is checked and the foreign edit is said to be unchecked", async () => {
    const root = await brandingProject();
    await editManifest(root, (m) => ({
      ...m,
      registries: { "@bg": "github:Netoun/bonne-garde-toolkit@v0.1.0" },
    }));
    const text = await readFile(join(root, "package.json"), "utf8");
    await writeFile(join(root, "package.json"), text.replace(SCRIPT, "bun mine.ts"));

    const report = await runDoctor(root);

    expect(codes(report, "regions")).toEqual([]);
    expect(report.checks.regions.notes.join(" ")).toMatch(
      /foreign edit of config\/branding's regions not checked: .*not local/s,
    );
  });

  test("an import, an export or a .use of a TypeScript file is read: present is checked, gone is an error", async () => {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      regions: {
        [BUTTON]: {
          "imports[react]": "button",
          "imports[motion/react]": "button",
          "imports[@app/auth]": "button",
          "exports[./x]": "button",
          "elysia[app].use[authModule]": "button",
        },
      },
    }));

    const report = await runDoctor(root);

    expect(report.checks.regions.details).toMatchObject({
      checked: [`${BUTTON}#imports[react]`, `${BUTTON}#imports[motion/react]`],
      missing: [
        `${BUTTON}#imports[@app/auth]`,
        `${BUTTON}#exports[./x]`,
        `${BUTTON}#elysia[app].use[authModule]`,
      ],
      unchecked: [],
    });
    expect(codes(report, "regions")).toEqual([
      "region-missing",
      "region-missing",
      "region-missing",
    ]);
  });

  test("a region of a kind doctor cannot resolve is listed as unchecked, not as an error", async () => {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      regions: { [BUTTON]: { "banner[top]": "button" } },
    }));

    const report = await runDoctor(root);

    expect(report.checks.regions.status).toBe("ok");
    expect(report.checks.regions.details).toMatchObject({ unchecked: [`${BUTTON}#banner[top]`] });
  });
});

describe("runDoctor: an intent[<id>] region, what an applied intention left on a file it edited", () => {
  const ID = "auth/fixture-auth/wire-auth-into-api";
  const REGION = `intent[${ID}]`;

  /** A tier-1 file of the project that an intention edited, so its sha256 no longer matches. */
  async function editedByIntention(options: {
    applied: boolean;
    region?: boolean;
  }): Promise<string> {
    const root = await projectWithButton();
    await writeFile(join(root, BUTTON), "// edited by the intention\n");
    const regions: ProjectManifest["regions"] = {};
    if (options.region !== false) {
      regions[BUTTON] = { [REGION]: "auth/fixture-auth" };
    }
    await editManifest(root, (m) => ({
      ...m,
      modules: {
        auth: [
          moduleRecord("fixture-auth", {
            intentions: { applied: options.applied ? [ID] : [], skipped: {} },
          }),
        ],
      },
      regions,
    }));
    return root;
  }

  test("the file is checked by region, so the edit is not user-modified, and strict is green", async () => {
    const report = await runDoctor(await editedByIntention({ applied: true }));

    expect(codes(report, "files")).toEqual([]);
    expect(report.checks.files.details).toMatchObject({ byRegion: [BUTTON], modified: [] });
    expect(codes(report, "regions")).toEqual([]);
    expect(report.status).toBe("ok");
    expect(doctorExitCode(report, true)).toBe(0);
  });

  test("without the region, the same edit is user-modified: what the region is for", async () => {
    const report = await runDoctor(await editedByIntention({ applied: true, region: false }));

    expect(codes(report, "files")).toEqual(["file-modified"]);
  });

  test("what is checked of it is the record: the region counts as read, with nothing to compare it with", async () => {
    const report = await runDoctor(await editedByIntention({ applied: true }));

    expect(report.checks.regions.details).toMatchObject({
      files: 1,
      regions: 1,
      checked: [`${BUTTON}#${REGION}`],
      missing: [],
      foreignEdit: [],
      unchecked: [],
    });
  });

  test("a region whose intention bg.json does not record as applied is an error: the record contradicts itself", async () => {
    const report = await runDoctor(await editedByIntention({ applied: false }));

    expect(codes(report, "regions")).toEqual(["region-missing"]);
    expect(report.checks.regions.findings[0]).toMatchObject({ severity: "error", path: BUTTON });
    expect(report.checks.regions.findings[0]?.message).toContain(ID);
    expect(report.checks.regions.findings[0]?.message).toContain("auth/fixture-auth");
    expect(report.checks.regions.details).toMatchObject({ missing: [`${BUTTON}#${REGION}`] });
    expect(doctorExitCode(report, false)).toBe(1);
  });

  test("a skipped intention is no record of an edit either", async () => {
    const root = await editedByIntention({ applied: false });
    await editManifest(root, (m) => ({
      ...m,
      modules: {
        auth: [
          moduleRecord("fixture-auth", { intentions: { applied: [], skipped: { [ID]: "no" } } }),
        ],
      },
    }));

    expect(codes(await runDoctor(root), "regions")).toEqual(["region-missing"]);
  });

  test("a JSON file is not read for it as a leaf: the key names no path in the file", async () => {
    const root = await editedByIntention({ applied: true });
    await writeFile(join(root, "package.json"), '{ "name": "mine" }\n');
    await editManifest(root, (m) => ({
      ...m,
      files: { ...m.files, "package.json": { owner: "button", sha256: "a".repeat(64) } },
      regions: { "package.json": { [REGION]: "auth/fixture-auth" } },
    }));

    const report = await runDoctor(root);

    expect(codes(report, "regions")).toEqual([]);
    expect(report.checks.regions.details).toMatchObject({ checked: [`package.json#${REGION}`] });
  });

  test("an owner that is not installed, and a file that is gone, are still errors", async () => {
    const root = await editedByIntention({ applied: true });
    await editManifest(root, (m) => ({ ...m, modules: {} }));
    expect(codes(await runDoctor(root), "regions")).toEqual(["region-owner-unknown"]);

    const gone = await editedByIntention({ applied: true });
    await unlink(join(gone, BUTTON));
    expect(codes(await runDoctor(gone), "regions")).toEqual(["region-file-missing"]);
  });
});

describe("runDoctor: manifest", () => {
  test("a missing bg.json is one error, and the other checks are skipped", async () => {
    const root = await emptyProject();
    await unlink(join(root, "bg.json"));

    const report = await runDoctor(root);

    expect(codes(report, "manifest")).toEqual(["manifest-missing"]);
    expect(report.status).toBe("error");
    for (const name of ["files", "regions", "patches", "intentions", "peers"] as const) {
      expect(report.checks[name].status).toBe("skipped");
    }
    expect(doctorExitCode(report, false)).toBe(1);
  });

  test("an unknown schema version fails closed", async () => {
    const root = await emptyProject();
    await writeFile(join(root, "bg.json"), JSON.stringify({ version: 3 }));

    const report = await runDoctor(root);

    expect(codes(report, "manifest")).toEqual(["manifest-invalid"]);
    expect(report.checks.manifest.findings[0]?.message).toContain("unsupported bg.json version");
    expect(report.checks.manifest.details).toMatchObject({ version: 3 });
    expect(report.status).toBe("error");
  });

  test("invalid JSON is an error naming the problem", async () => {
    const root = await emptyProject();
    await writeFile(join(root, "bg.json"), "{ nope");
    const report = await runDoctor(root);
    expect(codes(report, "manifest")).toEqual(["manifest-invalid"]);
  });

  test("a v1 bg.json is a warning that says it will be rewritten, and is not rewritten", async () => {
    const root = await emptyProject();
    const v1 = {
      version: 1,
      scope: "@legacy",
      platform: {
        version: "0.1.0",
        remote: "github:Netoun/bonne-garde-toolkit",
        intentions: { applied: [], skipped: {} },
      },
      registries: { "@bg": repoRegistry() },
      installed: {},
      capabilities: [],
    };
    const text = `${JSON.stringify(v1, null, 2)}\n`;
    await writeFile(join(root, "bg.json"), text);

    const report = await runDoctor(root);

    expect(codes(report, "manifest")).toEqual(["manifest-v1"]);
    expect(report.checks.manifest.findings[0]?.severity).toBe("warning");
    expect(report.checks.manifest.details).toMatchObject({ version: 1 });
    expect(await readFile(join(root, "bg.json"), "utf8")).toBe(text);
  });
});

describe("runDoctor: regions", () => {
  test("a region whose file is there and whose owner is installed is fine", async () => {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      regions: { [BUTTON]: { "imports[react]": "button" } },
    }));
    const report = await runDoctor(root);
    expect(report.checks.regions.status).toBe("ok");
    expect(report.checks.regions.details).toMatchObject({ files: 1, regions: 1 });
  });

  test("a region whose file is gone is an error", async () => {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      regions: { "apps/api/src/app.ts": { "elysia[app].use[authModule]": "button" } },
    }));
    const report = await runDoctor(root);
    expect(codes(report, "regions")).toEqual(["region-file-missing"]);
    expect(report.checks.regions.findings[0]).toMatchObject({
      severity: "error",
      path: "apps/api/src/app.ts",
    });
  });

  test("a region owned by something that is not installed is an error", async () => {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      regions: { [BUTTON]: { "imports[react]": "auth/fixture-auth" } },
    }));
    const report = await runDoctor(root);
    expect(codes(report, "regions")).toEqual(["region-owner-unknown"]);
    expect(report.checks.regions.findings[0]?.severity).toBe("error");
  });

  test("a region owned by an installed module is fine", async () => {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      modules: { auth: [moduleRecord("fixture-auth")] },
      regions: { [BUTTON]: { "imports[react]": "auth/fixture-auth" } },
    }));
    const report = await runDoctor(root);
    expect(codes(report, "regions")).toEqual([]);
  });

  describe("a dependency an item wrote into a package.json", () => {
    /** `button` owns `dependencies.zod` of the root package.json, as an item that declares `zod@4.4.3` would. */
    async function itemDependencyProject(): Promise<string> {
      const root = await projectWithButton();
      const path = join(root, "package.json");
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      await writeFile(
        path,
        `${JSON.stringify({ ...(parsed as object), dependencies: { zod: "4.4.3" } }, null, 2)}\n`,
      );
      await editManifest(root, (m) => ({
        ...m,
        regions: { "package.json": { "dependencies.zod": "button" } },
      }));
      return root;
    }

    test("is a region owned by the item: present is fine, and strict is green", async () => {
      const root = await itemDependencyProject();

      const report = await runDoctor(root);

      expect(codes(report, "regions")).toEqual([]);
      expect(report.checks.regions.details).toMatchObject({
        checked: ["package.json#dependencies.zod"],
      });
      expect(doctorExitCode(report, true)).toBe(0);
    });

    test("deleted from the package.json, it is an error that names it and its owner", async () => {
      const root = await itemDependencyProject();
      await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "x" }, null, 2)}\n`);

      const report = await runDoctor(root);

      expect(codes(report, "regions")).toEqual(["region-missing"]);
      expect(report.checks.regions.findings[0]?.message).toContain("recorded for button");
    });
  });

  test("says what it cannot see: a foreign edit leaves no trace in bg.json", async () => {
    const report = await runDoctor(await projectWithButton());
    expect(report.checks.regions.notes.join(" ")).toMatch(/foreign edit/);
  });
});

describe("runDoctor: a failed patch that became a pending intention", () => {
  const ID = "auth/fixture-auth/patch-ts-elysia-use-apps-api-src-app-ts-elysia-app-use-auth-module";
  const failed = {
    type: "ts.elysiaUse",
    file: "apps/api/src/app.ts",
    status: "failed" as const,
    reason: "apps/api/src/app.ts does not exist",
    intention: ID,
  };

  async function projectWithFailedPatch(
    intentions: { applied: string[]; skipped: Record<string, string> } = {
      applied: [],
      skipped: {},
    },
  ): Promise<string> {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      modules: { auth: [moduleRecord("fixture-auth", { patches: [failed], intentions })] },
    }));
    return root;
  }

  test("is one pending-intention warning, whether or not .bg/ still holds the file, and not a second one for the patch", async () => {
    const unstaged = await runDoctor(await projectWithFailedPatch());

    expect(codes(unstaged, "intentions")).toEqual(["intention-pending"]);
    expect(codes(unstaged, "patches")).toEqual([]);
    expect(unstaged.checks.intentions.findings[0]?.message).toContain(ID);
    expect(unstaged.checks.intentions.findings[0]?.message).toContain(failed.reason);
    expect(unstaged.checks.intentions.findings[0]?.message).toContain("not staged");
    expect(unstaged.checks.intentions.details?.pending).toEqual([
      {
        id: ID,
        file: null,
        patch: { type: "ts.elysiaUse", file: failed.file, reason: failed.reason },
      },
    ]);
    expect(doctorExitCode(unstaged, true)).toBe(1);
    expect(doctorExitCode(unstaged, false)).toBe(0);

    const root = await projectWithFailedPatch();
    await stage(root, "add", `01-${ID.split("/")[2]}.md`, ID);
    const staged = await runDoctor(root);

    expect(codes(staged, "intentions")).toEqual(["intention-pending"]);
    expect(codes(staged, "patches")).toEqual([]);
    expect(staged.checks.intentions.findings[0]?.message).toContain(
      `.bg/add/01-${ID.split("/")[2]}.md`,
    );
    expect(staged.checks.intentions.details?.pending).toHaveLength(1);
  });

  test("bonne-garde record closes it, applied or skipped: no finding, and --strict is green", async () => {
    const outcomes: { applied: string[]; skipped: Record<string, string> }[] = [
      { applied: [ID], skipped: {} },
      { applied: [], skipped: { [ID]: "no API in this project" } },
    ];
    for (const intentions of outcomes) {
      const root = await projectWithFailedPatch(intentions);
      await stage(root, "add", `01-${ID.split("/")[2]}.md`, ID);

      const report = await runDoctor(root);

      expect(codes(report, "intentions")).toEqual([]);
      expect(codes(report, "patches")).toEqual([]);
      expect(report.checks.patches.details).toMatchObject({ failed: 1 });
      expect(doctorExitCode(report, true)).toBe(0);
    }
  });

  test("a failed patch with no intention, as bg.json recorded one before the conversion existed, is still a patch-failed warning", async () => {
    const root = await projectWithButton();
    const { intention: _intention, ...legacy } = failed;
    await editManifest(root, (m) => ({
      ...m,
      modules: { auth: [moduleRecord("fixture-auth", { patches: [legacy] })] },
    }));

    const report = await runDoctor(root);

    expect(codes(report, "patches")).toEqual(["patch-failed"]);
    expect(codes(report, "intentions")).toEqual([]);
  });
});

describe("runDoctor: patches", () => {
  test("a failed patch is a warning carrying its module, file and reason", async () => {
    const root = await projectWithButton();
    await editManifest(root, (m) => ({
      ...m,
      modules: {
        auth: [
          moduleRecord("fixture-auth", {
            patches: [
              { type: "ts.elysiaUse", file: "apps/api/src/app.ts", status: "applied" },
              { type: "scripts.merge", file: "package.json", status: "skipped" },
              {
                type: "ts.addImport",
                file: "apps/api/src/index.ts",
                status: "failed",
                reason: "seam file not found",
              },
            ],
          }),
        ],
      },
    }));

    const report = await runDoctor(root);

    expect(codes(report, "patches")).toEqual(["patch-failed"]);
    expect(report.checks.patches.findings[0]).toMatchObject({
      severity: "warning",
      path: "apps/api/src/index.ts",
    });
    expect(report.checks.patches.findings[0]?.message).toContain("auth/fixture-auth");
    expect(report.checks.patches.findings[0]?.message).toContain("seam file not found");
    expect(report.checks.patches.details).toMatchObject({ applied: 1, skipped: 1, failed: 1 });
    expect(doctorExitCode(report, false)).toBe(0);
    expect(doctorExitCode(report, true)).toBe(1);
  });
});

describe("runDoctor: intentions", () => {
  test("a staged intention nobody recorded is pending: a warning", async () => {
    const root = await projectWithButton();
    await stage(root, "upgrade", "00-align-bun-pin.md", "v0.2.0/align-bun-pin");

    const report = await runDoctor(root);

    expect(codes(report, "intentions")).toEqual(["intention-pending"]);
    expect(report.checks.intentions.details).toMatchObject({
      pending: [{ id: "v0.2.0/align-bun-pin", file: ".bg/upgrade/00-align-bun-pin.md" }],
      applied: [],
      skipped: {},
    });
    expect(report.checks.intentions.findings[0]?.message).toContain("bonne-garde record");
    expect(doctorExitCode(report, true)).toBe(1);
  });

  test("reads install intentions staged under .bg/add too, and ignores session.md", async () => {
    const root = await projectWithButton();
    await stage(root, "add", "01-wire-auth-into-api.md", "auth/fixture-auth/wire-auth-into-api");
    await writeFile(join(root, ".bg/add/session.md"), "# session\n- [ ] auth/fixture-auth/wire\n");

    const report = await runDoctor(root);

    expect(report.checks.intentions.details?.pending.map((p) => p.id)).toEqual([
      "auth/fixture-auth/wire-auth-into-api",
    ]);
  });

  test("applied and skipped ids, platform and module, are resolved, not pending", async () => {
    const root = await projectWithButton();
    await stage(root, "upgrade", "00-align-bun-pin.md", "v0.2.0/align-bun-pin");
    await stage(root, "upgrade", "01-adopt-x.md", "v0.2.0/adopt-x");
    await stage(root, "add", "01-wire-auth-into-api.md", "auth/fixture-auth/wire-auth-into-api");
    await editManifest(root, (m) => ({
      ...m,
      platform: {
        ...m.platform,
        intentions: {
          applied: ["v0.2.0/align-bun-pin"],
          skipped: { "v0.2.0/adopt-x": "capability not installed" },
        },
      },
      modules: {
        auth: [
          moduleRecord("fixture-auth", {
            intentions: { applied: ["auth/fixture-auth/wire-auth-into-api"], skipped: {} },
          }),
        ],
      },
    }));

    const report = await runDoctor(root);

    expect(report.checks.intentions.status).toBe("ok");
    expect(report.checks.intentions.details).toEqual({
      applied: ["v0.2.0/align-bun-pin", "auth/fixture-auth/wire-auth-into-api"],
      skipped: { "v0.2.0/adopt-x": "capability not installed" },
      pending: [],
    });
    expect(doctorExitCode(report, true)).toBe(0);
  });

  test("a staged file whose frontmatter cannot be read is a warning, not a crash", async () => {
    const root = await projectWithButton();
    await mkdir(join(root, ".bg/upgrade"), { recursive: true });
    await writeFile(join(root, ".bg/upgrade/00-broken.md"), "# no frontmatter\n");

    const report = await runDoctor(root);

    expect(codes(report, "intentions")).toEqual(["intention-unreadable"]);
    expect(report.checks.intentions.findings[0]).toMatchObject({
      severity: "warning",
      path: ".bg/upgrade/00-broken.md",
    });
  });

  test("an absent .bg/ means nothing is pending", async () => {
    const report = await runDoctor(await projectWithButton());
    expect(report.checks.intentions.details).toEqual({ applied: [], skipped: {}, pending: [] });
  });
});

describe("runDoctor: peers", () => {
  /** A local registry holding `auth/better-auth` (with these peers) and a peer-free `db/d1`. */
  async function registryWithAuth(peers: Record<string, string[]>): Promise<string> {
    const root = await scratch("bg-doctor-reg-");
    const modules: [string, string, Record<string, string[]>][] = [
      ["auth", "better-auth", peers],
      ["db", "d1", {}],
    ];
    for (const [category, id, modulePeers] of modules) {
      await mkdir(join(root, "registry/modules", category, id), { recursive: true });
      await writeFile(
        join(root, "registry/modules", category, id, "module.json"),
        JSON.stringify({
          id,
          category,
          title: id,
          description: "A fixture module.",
          peers: modulePeers,
          variants: [{ key: "default", match: {} }],
        }),
      );
    }
    return `local:${join(root, "registry")}`;
  }

  async function withAuth(registry: string, extra: Partial<ProjectManifest> = {}) {
    const root = await emptyProject(registry);
    await editManifest(root, (m) => ({
      ...m,
      modules: { auth: [moduleRecord("better-auth")] },
      ...extra,
    }));
    return root;
  }

  test("a module whose peer category is empty is an error naming the category", async () => {
    const root = await withAuth(await registryWithAuth({ db: ["d1"] }));

    const report = await runDoctor(root);

    expect(codes(report, "peers")).toEqual(["peer-empty"]);
    expect(report.checks.peers.findings[0]).toMatchObject({ severity: "error" });
    expect(report.checks.peers.findings[0]?.message).toContain("auth/better-auth");
    expect(report.checks.peers.findings[0]?.message).toContain("db");
    expect(doctorExitCode(report, false)).toBe(1);
  });

  test("is fine once the peer category is filled", async () => {
    const root = await withAuth(await registryWithAuth({ db: ["d1"] }));
    await editManifest(root, (m) => ({
      ...m,
      modules: { ...m.modules, db: [moduleRecord("d1")] },
    }));
    const report = await runDoctor(root);
    expect(report.checks.peers.status).toBe("ok");
    expect(report.checks.peers.details).toMatchObject({ checked: ["db/d1", "auth/better-auth"] });
  });

  test("a module with no peers needs nothing", async () => {
    const report = await runDoctor(await withAuth(await registryWithAuth({})));
    expect(report.checks.peers.status).toBe("ok");
  });

  test("a registry it cannot read offline is a note, never a warning", async () => {
    const root = await withAuth("github:Netoun/bonne-garde-toolkit@v0.1.0");

    const report = await runDoctor(root);

    expect(report.checks.peers.status).toBe("ok");
    expect(report.checks.peers.findings).toEqual([]);
    expect(report.checks.peers.details).toMatchObject({ unchecked: ["auth/better-auth"] });
    expect(report.checks.peers.notes.join(" ")).toContain("auth/better-auth");
    expect(doctorExitCode(report, true)).toBe(0);
  });

  test("a clean add touches no module, so it never reads the registry", async () => {
    const root = await emptyProject("github:Netoun/bonne-garde-toolkit@v0.1.0");
    const report = await runDoctor(root);
    expect(report.checks.peers.details).toMatchObject({ checked: [], unchecked: [] });
    expect(report.checks.peers.notes).toEqual([]);
  });
});

describe("formatDoctor", () => {
  test("names every check, the offending path, and the verdict", async () => {
    const root = await projectWithButton();
    await writeFile(join(root, BUTTON), "// mine now\n");
    const text = formatDoctor(await runDoctor(root));
    for (const name of ["manifest", "files", "regions", "patches", "intentions", "peers"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain(BUTTON);
    expect(text).toContain("file-modified");
  });

  describe("with a hand-built report", () => {
    const check = (status: "ok" | "warning" | "error" | "skipped", extra = {}) => ({
      status,
      summary: `${status} summary`,
      details: null,
      findings: [],
      notes: [],
      ...extra,
    });
    const report = {
      status: "error",
      checks: {
        manifest: check("ok"),
        files: check("error", {
          findings: [{ severity: "error", code: "file-missing", message: "gone" }],
          notes: ["a note"],
        }),
        regions: check("warning"),
        patches: check("skipped"),
        intentions: check("ok"),
        peers: check("ok"),
      },
    } as unknown as DoctorReport;

    test("color: false is the plain text, with no escape code", () => {
      const text = formatDoctor(report, { color: false });
      expect(text).toBe(formatDoctor(report));
      expect(text).not.toContain("\u001b");
      expect(text).toContain(`manifest    ok       ok summary`);
      expect(text).toContain("    error file-missing: gone");
      expect(text).toContain("    note: a note");
      expect(text.endsWith("result: error")).toBe(true);
    });

    test("color: true paints ok green, error red, warning yellow, skipped dim, and keeps the words", () => {
      const text = formatDoctor(report, { color: true });
      expect(text).toContain("\u001b[32mok      \u001b[39m");
      expect(text).toContain("\u001b[31merror   \u001b[39m");
      expect(text).toContain("\u001b[33mwarning \u001b[39m");
      expect(text).toContain("\u001b[2mskipped \u001b[22m");
      expect(text).toContain("\u001b[1mmanifest   \u001b[22m");
      expect(text).toContain("\u001b[31mresult: error\u001b[39m");
      // Once the codes are gone it is the plain text.
      expect(stripVTControlCharacters(text)).toBe(formatDoctor(report));
    });
  });
});
