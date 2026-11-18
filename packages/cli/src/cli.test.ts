import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { addItems } from "./add";
import { createProject } from "./create";
import { findRepoRoot } from "./paths";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function repoRoot(): string {
  const root = findRepoRoot();
  if (!root) {
    throw new Error("repo root not found");
  }
  return root;
}

async function freshProject(prefix: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(parent);
  return createProject({
    name: "cli-app",
    cwd: parent,
    git: false,
    install: false,
    registry: `local:${join(repoRoot(), "registry")}`,
  }).then(({ target }) => target);
}

/** The commands the CLI prints name the runner of the package manager that started it: npm, here. */
const NPM_USER_AGENT = "npm/10.9.0 node/v22.12.0 darwin arm64";

/** Runs the real `bonne-garde` entry in `cwd`, the way a consumer does, started by npm. */
async function runBonneGarde(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", join(repoRoot(), "packages/cli/src/bin.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, npm_config_user_agent: NPM_USER_AGENT },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("bonne-garde add --yes", () => {
  test("is accepted as a flag, not read as an item name", async () => {
    const target = await freshProject("bg-cli-yes-");
    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "ui/shadcn",
      "button",
      "--yes",
      "--no-install",
    );
    expect(stderr).not.toContain("unknown registry item");
    expect(code).toBe(0);
    const added = JSON.parse(stdout);
    expect(added).toMatchObject({ dryRun: false, items: ["utils", "animations", "button"] });
    // meta.bg is gone, and its `capabilities` list with it.
    expect(added).not.toHaveProperty("capabilities");
  });

  test("an item that needs the ui module fails without it, naming ui/shadcn and the command to run", async () => {
    const target = await freshProject("bg-cli-no-ui-");
    const before = await readFile(join(target, "bg.json"), "utf8");

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "button",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "button needs the ui module, and none is installed or named in this call; run: npx bonne-garde add ui/shadcn button",
    );
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
  });

  test("a feature item fails without the modules it needs, naming each and the command that installs them, and writes nothing (030)", async () => {
    const target = await freshProject("bg-cli-no-auth-");
    await addItems({ projectRoot: target, items: ["ui/shadcn"], install: false });
    const before = await readFile(join(target, "bg.json"), "utf8");

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "spa-auth",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "spa-auth needs the auth and web/spa modules, and none is installed or named in this call; run: npx bonne-garde add auth/better-auth web/spa spa-auth",
    );
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
    expect(existsSync(join(target, "apps/spa"))).toBe(false);
  });

  test("a feature item in a bare project names every module it needs, ui included, together", async () => {
    const target = await freshProject("bg-cli-no-host-");

    const { stderr, code } = await runBonneGarde(
      target,
      "add",
      "spa-backoffice",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(1);
    expect(stderr).toContain(
      "spa-backoffice needs the ui, auth, web/spa and storage modules, and none is installed or named in this call; run: npx bonne-garde add ui/shadcn auth/better-auth web/spa storage/r2 spa-backoffice",
    );
  });

  test("is documented in --help", async () => {
    const { stdout, code } = await runBonneGarde(repoRoot(), "--help");
    expect(code).toBe(0);
    expect(stdout).toMatch(/bonne-garde add .*--yes/);
  });
});

describe("bonne-garde doctor", () => {
  const BUTTON = "packages/ui/src/components/button.tsx";

  async function projectWithButton(prefix: string): Promise<string> {
    const target = await freshProject(prefix);
    await addItems({ projectRoot: target, items: ["ui/shadcn", "button"], install: false });
    return target;
  }

  test("--strict exits 0 right after a clean add", async () => {
    const target = await projectWithButton("bg-cli-doctor-clean-");
    const { stdout, stderr, code } = await runBonneGarde(target, "doctor", "--strict");
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("result: ok");
  });

  test("names a modified file as user-modified; only --strict exits non-zero", async () => {
    const target = await projectWithButton("bg-cli-doctor-mod-");
    await writeFile(join(target, BUTTON), "// mine now\n");

    const plain = await runBonneGarde(target, "doctor");
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain(BUTTON);
    expect(plain.stdout).toContain("user-modified");

    const strict = await runBonneGarde(target, "doctor", "--strict");
    expect(strict.code).toBe(1);
    expect(strict.stdout).toContain(BUTTON);
  });

  test("reports a deleted file as missing, and exits non-zero without --strict", async () => {
    const target = await projectWithButton("bg-cli-doctor-del-");
    await unlink(join(target, BUTTON));

    const { stdout, code } = await runBonneGarde(target, "doctor");

    expect(code).toBe(1);
    expect(stdout).toContain(`${BUTTON} is missing`);
  });

  test("--json prints the report of all six checks, and the exit code does not change", async () => {
    const target = await projectWithButton("bg-cli-doctor-json-");
    await writeFile(join(target, BUTTON), "// mine now\n");

    const { stdout, code } = await runBonneGarde(target, "doctor", "--json", "--strict");

    expect(code).toBe(1);
    const parsed = JSON.parse(stdout) as {
      status: string;
      checks: Record<string, { status: string; findings: { code: string; path?: string }[] }>;
    };
    expect(Object.keys(parsed.checks)).toEqual([
      "manifest",
      "files",
      "regions",
      "patches",
      "intentions",
      "peers",
    ]);
    expect(parsed.status).toBe("warning");
    expect(parsed.checks.files?.findings).toEqual([
      expect.objectContaining({ code: "file-modified", path: BUTTON }),
    ]);

    expect((await runBonneGarde(target, "doctor", "--json")).code).toBe(0);
  });

  test("an argument it does not know fails, so a typo cannot pass a CI gate", async () => {
    const target = await projectWithButton("bg-cli-doctor-typo-");
    const { stderr, code } = await runBonneGarde(target, "doctor", "--strcit");
    expect(code).toBe(1);
    expect(stderr).toContain("--strcit");
  });

  test("is listed in --help", async () => {
    const { stdout } = await runBonneGarde(repoRoot(), "--help");
    expect(stdout).toMatch(/bonne-garde doctor \[--json\] \[--strict\]/);
  });
});

describe("bonne-garde record", () => {
  async function stageUpgrade(target: string, file: string, id: string): Promise<void> {
    await mkdir(join(target, ".bg/upgrade"), { recursive: true });
    await writeFile(
      join(target, ".bg/upgrade", file),
      `---\nid: ${id}\ndomain: tooling\nclassification: migration\n---\n\n# ${id}\n`,
    );
  }

  async function intentionsOf(target: string): Promise<{
    applied: string[];
    skipped: Record<string, string>;
  }> {
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      platform: { intentions: { applied: string[]; skipped: Record<string, string> } };
    };
    return bg.platform.intentions;
  }

  test("a pending intention becomes applied, or skipped with its reason, in bg.json and in doctor", async () => {
    const target = await freshProject("bg-cli-record-");
    await addItems({ projectRoot: target, items: ["ui/shadcn", "button"], install: false });
    await stageUpgrade(target, "00-align-bun-pin.md", "v0.2.0/align-bun-pin");
    await stageUpgrade(target, "01-adopt-x.md", "v0.2.0/adopt-x");

    const pending = await runBonneGarde(target, "doctor", "--strict");
    expect(pending.code).toBe(1);
    expect(pending.stdout).toContain("2 pending");
    expect(pending.stdout).toContain("v0.2.0/align-bun-pin");

    const applied = await runBonneGarde(target, "record", "v0.2.0/align-bun-pin");
    expect(applied.code).toBe(0);
    expect(applied.stdout).toContain("v0.2.0/align-bun-pin");
    expect(applied.stderr).toBe("");
    expect(await intentionsOf(target)).toEqual({ applied: ["v0.2.0/align-bun-pin"], skipped: {} });

    const half = await runBonneGarde(target, "doctor", "--json");
    const halfReport = JSON.parse(half.stdout) as {
      checks: { intentions: { details: { applied: string[]; pending: { id: string }[] } } };
    };
    expect(halfReport.checks.intentions.details.applied).toEqual(["v0.2.0/align-bun-pin"]);
    expect(halfReport.checks.intentions.details.pending.map((p) => p.id)).toEqual([
      "v0.2.0/adopt-x",
    ]);

    const skipped = await runBonneGarde(
      target,
      "record",
      "v0.2.0/adopt-x",
      "--skip",
      "capability not installed",
    );
    expect(skipped.code).toBe(0);
    expect(await intentionsOf(target)).toEqual({
      applied: ["v0.2.0/align-bun-pin"],
      skipped: { "v0.2.0/adopt-x": "capability not installed" },
    });

    const done = await runBonneGarde(target, "doctor", "--strict");
    expect(done.code).toBe(0);
    expect(done.stdout).toContain("1 applied, 1 skipped, 0 pending");
  });

  test("an install intention lands on its module's record and doctor reads it from there", async () => {
    const target = await freshProject("bg-cli-record-module-");
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const record = {
      id: "fixture-auth",
      variant: "default",
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      options: {},
      patches: [],
      intentions: { applied: [], skipped: {} },
    };
    await writeFile(
      join(target, "bg.json"),
      `${JSON.stringify({ ...bg, modules: { auth: [record] } }, null, 2)}\n`,
    );
    await mkdir(join(target, ".bg/add"), { recursive: true });
    await writeFile(
      join(target, ".bg/add/01-wire-auth-into-api.md"),
      "---\nid: auth/fixture-auth/wire-auth-into-api\ndomain: auth\nclassification: migration\n---\n",
    );

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "record",
      "auth/fixture-auth/wire-auth-into-api",
      "--skip",
      "no api app yet",
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("in auth/fixture-auth");
    const after = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      modules: { auth: { intentions: unknown }[] };
      platform: { intentions: unknown };
    };
    expect(after.modules.auth[0]?.intentions).toEqual({
      applied: [],
      skipped: { "auth/fixture-auth/wire-auth-into-api": "no api app yet" },
    });
    expect(after.platform.intentions).toEqual({ applied: [], skipped: {} });
    // the peers check cannot reach a module.json for this fixture, which is a note, so strict stays green
    expect((await runBonneGarde(target, "doctor", "--strict")).code).toBe(0);
  });

  test("an id that was never staged is recorded, with a warning on stderr", async () => {
    const target = await freshProject("bg-cli-record-unstaged-");
    const { stdout, stderr, code } = await runBonneGarde(target, "record", "v0.2.0/align-bun-pin");
    expect(code).toBe(0);
    expect(stdout).toContain("v0.2.0/align-bun-pin");
    expect(stderr).toContain("not staged");
    expect((await intentionsOf(target)).applied).toEqual(["v0.2.0/align-bun-pin"]);
  });

  test("a bad id, a missing module, a missing id or a bare --skip fail and leave bg.json as it was", async () => {
    const target = await freshProject("bg-cli-record-bad-");
    const before = await readFile(join(target, "bg.json"), "utf8");

    const cases: [string[], RegExp][] = [
      [["record", "align-bun-pin"], /canonical intention id/],
      [["record", "auth/better-auth/wire"], /auth\/better-auth is not installed/],
      [["record"], /requires an intention id/],
      [["record", "v0.2.0/x", "--skip"], /missing value for --skip/],
      [["record", "v0.2.0/x", "--skip", ""], /missing value for --skip/],
      [["record", "v0.2.0/x", "extra"], /unexpected argument: extra/],
    ];
    for (const [args, message] of cases) {
      const { stderr, code } = await runBonneGarde(target, ...args);
      expect(code).toBe(1);
      expect(stderr).toMatch(message);
    }
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
  });

  test("a v1 bg.json is rewritten as v2, and says so, like add", async () => {
    const target = await freshProject("bg-cli-record-v1-");
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const { apps: _apps, modules: _modules, items, files: _files, regions: _regions, ...rest } = bg;
    await writeFile(
      join(target, "bg.json"),
      `${JSON.stringify({ ...rest, version: 1, installed: items, capabilities: [] }, null, 2)}\n`,
    );

    const { stderr, code } = await runBonneGarde(target, "record", "v0.2.0/align-bun-pin");

    expect(code).toBe(0);
    expect(stderr).toContain("rewrote bg.json from version 1 to version 2");
    const after = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      version: number;
    };
    expect(after.version).toBe(2);
  });

  test("is listed in --help", async () => {
    const { stdout } = await runBonneGarde(repoRoot(), "--help");
    expect(stdout).toMatch(/bonne-garde record <intention-id> \[--skip "<reason>"\]/);
  });
});

describe("bonne-garde record: the files an install intention edited (060 Region ownership, 065 Recording)", () => {
  const ID = "auth/fixture-auth/wire-auth-into-api";
  const REGION = `intent[${ID}]`;
  const APP = "apps/api/src/app.ts";
  const MAILER = "packages/auth/src/mailer.ts";

  const documentOf = (paths: string[]): string =>
    [
      `---\nid: ${ID}\nkind: install\ndomain: auth\nclassification: migration\n---\n`,
      "# Wire auth\n",
      "## Goal\n\nx\n",
      `## Reference Paths\n\n${paths.map((path) => `- ${path}`).join("\n")}\n`,
      "## Validation\n\n- `bun run check`\n",
    ].join("\n");

  /** A project with a fixture auth module, the files an intention may name, and the document staged for it. */
  async function withStaged(
    prefix: string,
    paths: string[],
    options: { patches?: unknown[]; staged?: boolean } = {},
  ): Promise<string> {
    const target = await freshProject(prefix);
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const record = {
      id: "fixture-auth",
      variant: "default",
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      options: {},
      patches: options.patches ?? [],
      intentions: { applied: [], skipped: {} },
    };
    await writeFile(
      join(target, "bg.json"),
      `${JSON.stringify({ ...bg, modules: { auth: [record] } }, null, 2)}\n`,
    );
    for (const file of [APP, MAILER]) {
      await mkdir(join(target, file, ".."), { recursive: true });
      await writeFile(join(target, file), "// the project's\n");
    }
    if (options.staged !== false) {
      await mkdir(join(target, ".bg/add"), { recursive: true });
      await writeFile(join(target, ".bg/add/01-wire-auth-into-api.md"), documentOf(paths));
    }
    return target;
  }

  const regionsOf = async (target: string): Promise<Record<string, Record<string, string>>> =>
    (
      JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
        regions: Record<string, Record<string, string>>;
      }
    ).regions;

  test("an applied intention takes an intent region, owned by its module, on each file it declares adapt, and not on one it declares copy", async () => {
    const target = await withStaged("bg-cli-record-adapt-", [
      `\`adapt\` \`${MAILER}\` — read it first`,
      `\`adapt\` \`${APP}\``,
      "`copy` `packages/auth/src/new.ts`",
    ]);

    const { stdout, stderr, code } = await runBonneGarde(target, "record", ID);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain(`recorded ${ID} as applied in auth/fixture-auth`);
    expect(stdout).toContain(MAILER);
    expect(await regionsOf(target)).toEqual({
      [APP]: { [REGION]: "auth/fixture-auth" },
      [MAILER]: { [REGION]: "auth/fixture-auth" },
    });
    // The file is region-checked now, and the record is what doctor reads of the region.
    const doctor = await runBonneGarde(target, "doctor", "--strict");
    expect(doctor.stdout).toContain("2 regions in 2 files, 2 read");
    expect(doctor.code).toBe(0);
  });

  test("--skip records no region, and one an earlier record left is gone", async () => {
    const target = await withStaged("bg-cli-record-skip-", [`\`adapt\` \`${MAILER}\``]);
    await runBonneGarde(target, "record", ID);
    expect(Object.keys(await regionsOf(target))).toEqual([MAILER]);

    const skipped = await runBonneGarde(
      target,
      "record",
      ID,
      "--skip",
      "the project wires auth itself",
    );

    expect(skipped.code).toBe(0);
    expect(skipped.stdout).not.toContain("edited");
    expect(await regionsOf(target)).toEqual({});
  });

  test("a path that is not a file of the project is not marked, and is said on stderr; the rest are", async () => {
    const target = await withStaged("bg-cli-record-missing-", [
      "`adapt` `packages/auth/src/not-there.ts`",
      `\`adapt\` \`${MAILER}\``,
    ]);

    const { stderr, code } = await runBonneGarde(target, "record", ID);

    expect(code).toBe(0);
    expect(stderr).toContain("packages/auth/src/not-there.ts is not a file of the project");
    expect(await regionsOf(target)).toEqual({ [MAILER]: { [REGION]: "auth/fixture-auth" } });
  });

  test("the file of a failed patch is the one it adapted, though .bg/ is gone: bg.json is what is read", async () => {
    const target = await withStaged("bg-cli-record-patch-", [], {
      staged: false,
      patches: [
        {
          type: "ts.elysiaUse",
          file: APP,
          status: "failed",
          reason: "no chain",
          intention: ID,
        },
      ],
    });

    const { stderr, code } = await runBonneGarde(target, "record", ID);

    expect(code).toBe(0);
    expect(stderr).toContain("not staged");
    expect(stderr).not.toContain("no file was marked");
    expect(await regionsOf(target)).toEqual({ [APP]: { [REGION]: "auth/fixture-auth" } });
  });

  test("an applied intention with no document to read is refused, writes nothing, and says to add the module again", async () => {
    const target = await withStaged("bg-cli-record-nodoc-", [], { staged: false });
    const before = await readFile(join(target, "bg.json"), "utf8");

    const { stdout, stderr, code } = await runBonneGarde(target, "record", ID);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(`cannot record ${ID} as applied`);
    expect(stderr).toContain("bonne-garde add auth/fixture-auth");
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
  });

  test("--skip needs no document: a skipped intention edited nothing, so it is recorded in the same state", async () => {
    const target = await withStaged("bg-cli-record-nodoc-skip-", [], { staged: false });

    const { stderr, code } = await runBonneGarde(
      target,
      "record",
      ID,
      "--skip",
      "the project wires auth itself",
    );

    expect(code).toBe(0);
    expect(stderr).toContain(`${ID} is not staged under .bg/`);
    expect(await regionsOf(target)).toEqual({});
  });

  test("a document that declares no adapt path is read, so it is recorded with nothing to mark", async () => {
    const target = await withStaged("bg-cli-record-noadapt-", [
      "`copy` `packages/auth/src/new.ts`",
    ]);

    const { stderr, code } = await runBonneGarde(target, "record", ID);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(await regionsOf(target)).toEqual({});
  });

  test("a release intention has no module to own a region, so it marks nothing", async () => {
    const target = await withStaged("bg-cli-record-release-", []);
    await mkdir(join(target, ".bg/upgrade"), { recursive: true });
    await writeFile(
      join(target, ".bg/upgrade/00-align-bun-pin.md"),
      `---\nid: v0.2.0/align-bun-pin\ndomain: tooling\nclassification: migration\n---\n\n## Reference Paths\n\n- \`adapt\` \`${MAILER}\`\n`,
    );

    const { stderr, code } = await runBonneGarde(target, "record", "v0.2.0/align-bun-pin");

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(await regionsOf(target)).toEqual({});
  });
});

describe("bonne-garde record: an intention the module ships, with no .bg/ and no failed patch to read it from (065 Recording)", () => {
  // The real registry's email module: its `better-auth` variant ships the intention, which adapts auth's mailer.
  const ID = "email/resend/wire-email-into-auth";
  const REGION = `intent[${ID}]`;
  const MAILER = "packages/auth/src/mailer.ts";

  /** A project that has email on `variant`, the intention recorded as `skipped`, no `.bg/`, and auth's mailer. */
  async function skippedProject(prefix: string, variant: string): Promise<string> {
    const target = await freshProject(prefix);
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const record = {
      id: "resend",
      variant,
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      options: {},
      patches: [],
      intentions: { applied: [], skipped: { [ID]: "not now" } },
    };
    await writeFile(
      join(target, "bg.json"),
      `${JSON.stringify({ ...bg, modules: { email: [record] } }, null, 2)}\n`,
    );
    await mkdir(join(target, MAILER, ".."), { recursive: true });
    await writeFile(join(target, MAILER), "// the project's\n");
    return target;
  }

  const recorded = async (target: string) =>
    JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      modules: { email: { intentions: { applied: string[]; skipped: Record<string, string> } }[] };
      regions: Record<string, Record<string, string>>;
    };

  test("a skipped intention is applied later: the paths come from the registry's own document, and the file it edited is marked", async () => {
    const target = await skippedProject("bg-cli-record-registry-", "better-auth");
    expect(existsSync(join(target, ".bg"))).toBe(false);

    const { stdout, stderr, code } = await runBonneGarde(target, "record", ID);

    expect(code).toBe(0);
    expect(stdout).toContain(`recorded ${ID} as applied in email/resend`);
    expect(stdout).toContain(MAILER);
    expect(stderr).toContain("not staged");
    const bg = await recorded(target);
    expect(bg.modules.email[0]?.intentions).toEqual({ applied: [ID], skipped: {} });
    expect(bg.regions).toEqual({ [MAILER]: { [REGION]: "email/resend" } });
  });

  test("the registry is read for the variant the project installed: a variant that ships no such intention leaves the refusal, and nothing is written", async () => {
    const target = await skippedProject("bg-cli-record-variant-", "default");
    const before = await readFile(join(target, "bg.json"), "utf8");

    const { stdout, stderr, code } = await runBonneGarde(target, "record", ID);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(`cannot record ${ID} as applied`);
    expect(stderr).toContain("the registry");
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
  });

  test("--skip still reads nothing: a registry that cannot be reached does not stop a skip", async () => {
    const target = await skippedProject("bg-cli-record-skip-offline-", "better-auth");
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      registries: Record<string, string>;
    };
    await writeFile(
      join(target, "bg.json"),
      `${JSON.stringify({ ...bg, registries: { "@bg": "local:./nowhere" } }, null, 2)}\n`,
    );

    const { code } = await runBonneGarde(target, "record", ID, "--skip", "still not now");

    expect(code).toBe(0);
  });
});

/** Every path under `root` with its content, so two trees compare whole. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out[`${relative(root, path)}/`] = "<dir>";
        await walk(path);
      } else {
        out[relative(root, path)] = await readFile(path, "utf8");
      }
    }
  };
  await walk(root);
  return out;
}

type ModuleOutput = {
  dryRun: boolean;
  written: string[];
  skippedIdentical: string[];
  kept: string[];
  tookOver: { path: string; from: string; by: string }[];
  modules: {
    module: string;
    variant: string;
    files: string[];
    env: { name: string; required: boolean; status: string }[];
    checks: string[];
    workspace: string | null;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    patches: PatchOutput[];
  }[];
  failedPatches: (PatchOutput & { module: string })[];
  /** The installed modules this call planned again, on the variant a module it adds selects. */
  reselected: { module: string; from: string; to: string; because: string[] }[];
  pendingIntentions: {
    id: string;
    module: string;
    /** `null` for an intention a module authors: it is no failed patch. */
    type: string | null;
    file: string | null;
    intent: string;
    reason: string | null;
    staged: string | null;
  }[];
  session: string | null;
};

type PatchOutput = {
  type: string;
  file: string;
  status: string;
  reason?: string;
  intention?: string;
  regions: { region: string; status: string; replaced?: string | null }[];
};

/** What `provider/cloudflare` writes, in the order `bonne-garde add` prints it. */
const CLOUDFLARE_FILES = [
  "packages/api-runtime/package.json",
  "packages/api-runtime/src/index.test.ts",
  "packages/api-runtime/src/index.ts",
  "packages/api-runtime/tsconfig.json",
  "packages/api-runtime/tsconfig.test.json",
];

describe("bonne-garde add <module>", () => {
  test("installs the cloudflare provider by its bare id: files, env, records, and doctor is green", async () => {
    const target = await freshProject("bg-cli-mod-cf-");

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "cloudflare",
      "--yes",
      "--no-install",
    );

    // `add` prints the checks the module declares and does not run them (050 step 15).
    expect(stderr).toContain("checks were not run");
    expect(stderr).toContain("cd packages/api-runtime && vp run typecheck && vp run test");
    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.written).toEqual(CLOUDFLARE_FILES);
    expect(out.modules).toEqual([
      expect.objectContaining({
        module: "provider/cloudflare",
        variant: "default",
        files: CLOUDFLARE_FILES,
        workspace: "packages/api-runtime",
        dependencies: { elysia: "1.4.29" },
        // 035: a key belongs to the module that reads it, and nothing in this provider reads one.
        env: [],
      }),
    ]);

    const template = await readFile(
      join(
        repoRoot(),
        "registry/modules/provider/cloudflare/template/packages/api-runtime/src/index.ts",
      ),
      "utf8",
    );
    expect(await readFile(join(target, "packages/api-runtime/src/index.ts"), "utf8")).toBe(
      template,
    );
    // 035: the vendored package.json carries exports and scripts, and the variant's maps are merged in.
    expect(
      JSON.parse(await readFile(join(target, "packages/api-runtime/package.json"), "utf8")),
    ).toMatchObject({
      name: "@cli-app/api-runtime",
      exports: { ".": "./src/index.ts" },
      scripts: { test: "vp test" },
      dependencies: { elysia: "1.4.29" },
      devDependencies: { "@cloudflare/workers-types": "5.20260804.1", "@types/node": "26.1.2" },
    });
    // 035 (d): a provider writes nothing under apps/*; the Worker's wrangler.jsonc is the api module's.
    expect(out.written.filter((path) => path.startsWith("apps/"))).toEqual([]);
    await expect(readFile(join(target, ".env.example"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });

    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      modules: Record<string, Record<string, unknown>[]>;
      files: Record<string, { owner: string; sha256: string }>;
      regions: Record<string, Record<string, string>>;
    };
    // 070: a module is recorded at the lockstep version, the running CLI package's.
    const cli = JSON.parse(await readFile(join(import.meta.dir, "../package.json"), "utf8"));
    expect(bg.modules.provider).toEqual([
      expect.objectContaining({
        id: "cloudflare",
        variant: "default",
        version: cli.version,
        options: {},
        patches: [],
        intentions: { applied: [], skipped: {} },
      }),
    ]);
    expect(bg.files["packages/api-runtime/src/index.ts"]?.owner).toBe("provider/cloudflare");
    expect(bg.regions[".env.example"]).toBeUndefined();

    const doctor = await runBonneGarde(target, "doctor", "--strict");
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain("result: ok");
  });

  test("the qualified name does the same, and a second add is idempotent", async () => {
    const target = await freshProject("bg-cli-mod-twice-");
    await runBonneGarde(target, "add", "provider/cloudflare", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stdout, code } = await runBonneGarde(
      target,
      "add",
      "provider/cloudflare",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.written).toEqual([]);
    expect(out.skippedIdentical).toEqual(CLOUDFLARE_FILES);
    expect(out.kept).toEqual([]);
    expect(out.modules[0]?.env).toEqual([]);
    const after = await snapshot(target);
    const withoutInstalledAt = (tree: Record<string, string>) =>
      (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"');
    expect({ ...after, "bg.json": withoutInstalledAt(after) }).toEqual({
      ...before,
      "bg.json": withoutInstalledAt(before),
    });
  });

  test("a second provider fails on cardinality, pointing at bonne-garde replace, and changes nothing", async () => {
    const target = await freshProject("bg-cli-mod-card-");
    await runBonneGarde(target, "add", "cloudflare", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stderr, code } = await runBonneGarde(
      target,
      "add",
      "dockerfile",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(1);
    expect(stderr).toContain("provider is already filled by provider/cloudflare");
    expect(stderr).toContain("bonne-garde replace provider/dockerfile");
    expect(await snapshot(target)).toEqual(before);
  });

  test("two providers in one call fail before anything is written", async () => {
    const target = await freshProject("bg-cli-mod-card2-");
    const before = await snapshot(target);

    const { stderr, code } = await runBonneGarde(
      target,
      "add",
      "cloudflare",
      "dockerfile",
      "--no-install",
    );

    expect(code).toBe(1);
    expect(stderr).toContain("provider admits one module");
    expect(await snapshot(target)).toEqual(before);
  });

  test("--dry-run prints the plan and writes nothing", async () => {
    const target = await freshProject("bg-cli-mod-dry-");
    const before = await snapshot(target);

    const { stdout, code } = await runBonneGarde(target, "add", "dockerfile", "--dry-run", "--yes");

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.dryRun).toBe(true);
    expect(out.written).toEqual([
      ".dockerignore",
      "Dockerfile",
      "compose.yaml",
      "packages/api-runtime/package.json",
      "packages/api-runtime/src/index.test.ts",
      "packages/api-runtime/src/index.ts",
      "packages/api-runtime/src/main.ts",
      "packages/api-runtime/tsconfig.json",
    ]);
    expect(out.modules[0]?.env.map((key) => key.name)).toEqual([
      "PORT",
      "DATA_DIR",
      "APP_URL",
      "TRUSTED_PROXY_HEADER",
    ]);
    expect(await snapshot(target)).toEqual(before);
  });

  test("renders the project's scope into the dockerfile module, and its Dockerfile builds with the root script", async () => {
    const target = await freshProject("bg-cli-mod-scope-");

    await runBonneGarde(target, "add", "dockerfile", "--yes", "--no-install");

    const runtime = JSON.parse(
      await readFile(join(target, "packages/api-runtime/package.json"), "utf8"),
    ) as { name: string; dependencies: Record<string, string> };
    expect(runtime.name).toBe("@cli-app/api-runtime");
    expect(runtime.dependencies).toEqual({ elysia: "1.4.29", srvx: "1.0.8" });
    // 09 (c): a project with no SPA workspace has to build, so no `--filter '<scope>/spa'`.
    const dockerfile = await readFile(join(target, "Dockerfile"), "utf8");
    // The package manager package.json pins runs the root build script.
    expect(dockerfile).toContain('&& "${pinned%@*}" run build\n');
    expect(dockerfile).not.toContain("--filter");
    expect(dockerfile).not.toContain("{{SCOPE}}");
  });

  test("an item and a module go in one call, items first in the output", async () => {
    const target = await freshProject("bg-cli-mod-mixed-");

    const { stdout, code } = await runBonneGarde(
      target,
      "add",
      "utils",
      "pm/bun",
      "dockerfile",
      "ui/shadcn",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput & { items: string[] };
    expect(out.items).toEqual(["utils"]);
    expect(out.modules.map((m) => m.module)).toEqual([
      "pm/bun",
      "provider/dockerfile",
      "ui/shadcn",
    ]);
  });

  test("an unknown name fails with suggestions from both catalogs", async () => {
    const target = await freshProject("bg-cli-mod-unknown-");

    const { stderr, code } = await runBonneGarde(target, "add", "cloud", "--no-install");

    expect(code).toBe(1);
    expect(stderr).toContain("unknown name: cloud");
    expect(stderr).toContain("provider/cloudflare");
  });

  test("--set, bonne-garde remove and bonne-garde replace say they are not supported yet instead of doing nothing", async () => {
    const target = await freshProject("bg-cli-mod-todo-");

    const set = await runBonneGarde(target, "add", "cloudflare", "--set", "a=b");
    expect(set.code).toBe(1);
    expect(set.stderr).toContain("--set is not supported yet");

    for (const command of ["remove", "replace"]) {
      const result = await runBonneGarde(target, command, "cloudflare");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`bonne-garde ${command} is not supported yet`);
    }
  });
});

describe("bonne-garde add config/branding: scripts.merge, the first tier-2 patch (060)", () => {
  const SCRIPT = "tsx packages/config/scripts/gen-branding.ts";
  const REGION = "scripts.gen:branding";

  async function rootScripts(target: string): Promise<Record<string, string>> {
    const body = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    return body.scripts;
  }

  test("adds the root script, and the JSON says per module and per region what the patch did", async () => {
    const target = await freshProject("bg-cli-patch-");
    const before = await readFile(join(target, "package.json"), "utf8");

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "config/branding",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    expect(stderr).toContain("checks were not run");
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "applied",
        regions: [{ region: REGION, status: "applied" }],
      },
    ]);
    expect(out.failedPatches).toEqual([]);
    // The file the patch edited is not one the module wrote.
    expect(out.written).not.toContain("package.json");

    expect((await rootScripts(target))["gen:branding"]).toBe(SCRIPT);
    expect(await readFile(join(target, "package.json"), "utf8")).toBe(
      before.replace(
        '    "prepare": "husky"\n',
        `    "prepare": "husky",\n    "gen:branding": "${SCRIPT}"\n`,
      ),
    );
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      regions: Record<string, Record<string, string>>;
      modules: { config: { patches: unknown[] }[] };
    };
    expect(bg.regions["package.json"]).toEqual({ [REGION]: "config/branding" });
    expect(bg.modules.config[0]?.patches).toEqual([
      { type: "scripts.merge", file: "package.json", status: "applied" },
    ]);
    const doctor = await runBonneGarde(target, "doctor", "--strict");
    expect(doctor.code).toBe(0);
  });

  test("the same add again reports the patch skipped, and the project is the same bytes", async () => {
    const target = await freshProject("bg-cli-patch-twice-");
    await runBonneGarde(target, "add", "config/branding", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stdout, code } = await runBonneGarde(
      target,
      "add",
      "config/branding",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "skipped",
        regions: [{ region: REGION, status: "skipped" }],
      },
    ]);
    expect(out.written).toEqual([]);
    // `installedAt` is the one thing a re-add moves in bg.json: the record keeps `applied`.
    const settled = (tree: Record<string, string>) => ({
      ...tree,
      "bg.json": (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"'),
    });
    expect(settled(await snapshot(target))).toEqual(settled(before));
  });

  test("a hand-edited script is refused, naming the region and --force, and --force puts it back", async () => {
    const target = await freshProject("bg-cli-patch-edit-");
    await runBonneGarde(target, "add", "config/branding", "--yes", "--no-install");
    const clean = await readFile(join(target, "package.json"), "utf8");
    await writeFile(join(target, "package.json"), clean.replace(SCRIPT, "bun my-own.ts"));
    const edited = await snapshot(target);

    const refused = await runBonneGarde(target, "add", "config/branding", "--yes", "--no-install");

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`${REGION} of package.json is "bun my-own.ts"`);
    expect(refused.stderr).toContain("--force");
    expect(await snapshot(target)).toEqual(edited);

    const forced = await runBonneGarde(
      target,
      "add",
      "config/branding",
      "--yes",
      "--no-install",
      "--force",
    );

    expect(forced.code).toBe(0);
    expect((JSON.parse(forced.stdout) as ModuleOutput).modules[0]?.patches[0]?.regions).toEqual([
      { region: REGION, status: "applied", replaced: "bun my-own.ts" },
    ]);
    expect(await readFile(join(target, "package.json"), "utf8")).toBe(clean);
  });

  test("a patch that cannot apply is a pending intention: staged, reported by doctor, closed by bonne-garde record, and the install completes", async () => {
    const target = await freshProject("bg-cli-patch-failed-");
    const root = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify({ ...root, scripts: "nope" }, null, 2)}\n`,
    );

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "config/branding",
      "--yes",
      "--no-install",
    );

    // The install completes: 060 says a failed patch never aborts it.
    expect(code).toBe(0);
    expect(await readFile(join(target, "packages/config/src/index.ts"), "utf8")).toContain(
      "branding",
    );
    const id = "config/branding/patch-scripts-merge-package-json-scripts-gen-branding";
    const out = JSON.parse(stdout) as ModuleOutput;
    const failed = {
      module: "config/branding",
      type: "scripts.merge",
      file: "package.json",
      status: "failed",
      reason: 'package.json: "scripts" is a string, not an object',
      intention: id,
      regions: [],
    };
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "failed",
        reason: failed.reason,
        intention: id,
        regions: [],
      },
    ]);
    expect(out.failedPatches).toEqual([failed]);
    expect(out.pendingIntentions).toEqual([
      {
        id,
        module: "config/branding",
        type: "scripts.merge",
        file: "package.json",
        intent:
          'The scripts.merge patch of config/branding makes package.json hold: scripts.gen:branding = "tsx packages/config/scripts/gen-branding.ts".',
        reason: failed.reason,
        staged: `.bg/add/01-${id.split("/")[2]}.md`,
      },
    ]);
    expect(out.session).toBe(".bg/add/session.md");
    // Never silent: the failure, the id, and where to start.
    expect(stderr).toContain(
      "bonne-garde: PATCH FAILED scripts.merge on package.json (config/branding)",
    );
    expect(stderr).toContain(failed.reason);
    expect(stderr).toContain(`pending intention ${id}`);
    expect(stderr).toContain("read .bg/add/session.md");
    expect(stderr).not.toContain("not implemented");

    // The staged intention and the entry point are on disk, and what bg.json keeps is durable.
    const staged = await readFile(join(target, out.pendingIntentions[0]?.staged ?? ""), "utf8");
    expect(staged).toContain(`id: ${id}`);
    expect(staged).toContain(failed.reason);
    expect(await readFile(join(target, ".bg/add/session.md"), "utf8")).toContain(id);
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      modules: { config: { patches: unknown[] }[] };
    };
    expect(bg.modules.config[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "failed",
        reason: failed.reason,
        intention: id,
      },
    ]);

    // doctor: one finding for the failure, pending, and --strict fails on it.
    const doctor = await runBonneGarde(target, "doctor", "--strict");
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain("intention-pending");
    expect(doctor.stdout).toContain(id);
    expect(doctor.stdout).toContain(failed.reason);
    expect(doctor.stdout).not.toContain("patch-failed");
    expect((await runBonneGarde(target, "doctor")).code).toBe(0);

    // The same add again is the same intention in the same file: nothing staged moves.
    const staging = async () =>
      (await snapshot(target))[out.pendingIntentions[0]?.staged ?? ""] ?? "missing";
    const before = await staging();
    const again = await runBonneGarde(target, "add", "config/branding", "--yes", "--no-install");
    expect(again.code).toBe(0);
    expect(await staging()).toBe(before);

    // bonne-garde record closes it, and the failed patch it came from is no longer a finding.
    const recorded = await runBonneGarde(
      target,
      "record",
      id,
      "--skip",
      "this project has no root script",
    );
    expect(recorded.code).toBe(0);
    const closed = await runBonneGarde(target, "doctor", "--strict");
    expect(closed.code).toBe(0);
    expect(closed.stdout).not.toContain("intention-pending");
    // A resolved intention is not pending again on the next add, though the patch still fails.
    const last = await runBonneGarde(target, "add", "config/branding", "--yes", "--no-install");
    expect(last.code).toBe(0);
    expect((JSON.parse(last.stdout) as ModuleOutput).pendingIntentions).toEqual([]);
    expect((JSON.parse(last.stdout) as ModuleOutput).failedPatches).toHaveLength(1);
  });

  test("--dry-run reports the intention a failing patch would become, and stages nothing", async () => {
    const target = await freshProject("bg-cli-patch-dry-failed-");
    const root = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify({ ...root, scripts: "nope" }, null, 2)}\n`,
    );
    const before = await snapshot(target);

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "config/branding",
      "--dry-run",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.pendingIntentions.map(({ id, staged }) => [id, staged])).toEqual([
      ["config/branding/patch-scripts-merge-package-json-scripts-gen-branding", null],
    ]);
    expect(out.session).toBeNull();
    expect(stderr).toContain("dry run: nothing staged");
    expect(await snapshot(target)).toEqual(before);
  });

  test("--dry-run prints the patch and writes nothing", async () => {
    const target = await freshProject("bg-cli-patch-dry-");
    const before = await snapshot(target);

    const { stdout, code } = await runBonneGarde(
      target,
      "add",
      "config/branding",
      "--dry-run",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.dryRun).toBe(true);
    expect(out.modules[0]?.patches[0]).toMatchObject({
      type: "scripts.merge",
      status: "applied",
      regions: [{ region: REGION, status: "applied" }],
    });
    expect(await snapshot(target)).toEqual(before);
  });

  test("a module without a patch prints an empty list, and nothing on stderr about patches", async () => {
    const target = await freshProject("bg-cli-patch-none-");

    const { stdout, stderr } = await runBonneGarde(
      target,
      "add",
      "provider/cloudflare",
      "--yes",
      "--no-install",
    );

    expect((JSON.parse(stdout) as ModuleOutput).modules[0]?.patches).toEqual([]);
    expect(stderr).not.toContain("PATCH");
  });
});

describe("bonne-garde add api/elysia: a module that vendors a file and patches it (035, 060)", () => {
  const FILE = "apps/api/package.json";
  const DEV_CLOUDFLARE = "wrangler dev --port 5172";

  async function installed(prefix: string, provider: "cloudflare" | "dockerfile") {
    const target = await freshProject(prefix);
    const first = await runBonneGarde(
      target,
      "add",
      "pm/bun",
      "config/branding",
      `provider/${provider}`,
      "api/elysia",
      "--yes",
      "--no-install",
    );
    expect(first.code).toBe(0);
    return { target, out: JSON.parse(first.stdout) as ModuleOutput };
  }

  async function scriptsOf(target: string): Promise<Record<string, string>> {
    const body = JSON.parse(await readFile(join(target, FILE), "utf8")) as {
      scripts: Record<string, string>;
    };
    return body.scripts;
  }

  test("the cloudflare variant writes wrangler.jsonc and patches dev and deploy, with no --force", async () => {
    const { target, out } = await installed("bg-cli-api-cf-", "cloudflare");

    const api = out.modules.find((module) => module.module === "api/elysia");
    expect(api?.variant).toBe("cloudflare");
    expect(api?.files).toContain("apps/api/wrangler.jsonc");
    expect(api?.patches).toEqual([
      {
        type: "scripts.merge",
        file: FILE,
        status: "applied",
        regions: [
          { region: "scripts.dev", status: "applied" },
          { region: "scripts.deploy", status: "applied" },
        ],
      },
    ]);
    expect(out.failedPatches).toEqual([]);
    // A file the module wrote and the patch then edited is in `written`, once.
    expect(out.written.filter((path) => path === FILE)).toEqual([FILE]);
    expect(await scriptsOf(target)).toMatchObject({
      dev: DEV_CLOUDFLARE,
      deploy: "wrangler deploy",
    });
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      regions: Record<string, Record<string, string>>;
      files: Record<string, { owner: string }>;
    };
    expect(bg.regions[FILE]).toEqual({
      "scripts.dev": "api/elysia",
      "scripts.deploy": "api/elysia",
    });
    expect(bg.files[FILE]?.owner).toBe("api/elysia");
    expect(bg.files["apps/api/wrangler.jsonc"]?.owner).toBe("api/elysia");
    // The provider owns the runtime package, and nothing it wrote is under apps/.
    expect(bg.files["packages/api-runtime/src/index.ts"]?.owner).toBe("provider/cloudflare");
    expect(
      Object.entries(bg.files).filter(
        ([path, { owner }]) => owner === "provider/cloudflare" && path.startsWith("apps/"),
      ),
    ).toEqual([]);
    const doctor = await runBonneGarde(target, "doctor", "--strict");
    expect(doctor.code).toBe(0);
  });

  test("the dockerfile variant writes no wrangler.jsonc, and a dev script that runs on Bun", async () => {
    const { target, out } = await installed("bg-cli-api-docker-", "dockerfile");

    const api = out.modules.find((module) => module.module === "api/elysia");
    expect(api?.variant).toBe("dockerfile");
    expect(api?.files).not.toContain("apps/api/wrangler.jsonc");
    expect(api?.devDependencies).toEqual({});
    expect(api?.patches[0]?.regions).toEqual([{ region: "scripts.dev", status: "applied" }]);
    const scripts = await scriptsOf(target);
    expect(scripts.dev).toBe("tsx watch src/index.ts");
    expect(scripts).not.toHaveProperty("deploy");
    expect((await runBonneGarde(target, "doctor", "--strict")).code).toBe(0);
  });

  test("the same add again reports every patch skipped, and the project is the same bytes", async () => {
    const { target } = await installed("bg-cli-api-twice-", "cloudflare");
    const before = await snapshot(target);

    const again = await runBonneGarde(target, "add", "api/elysia", "--yes", "--no-install");

    expect(again.code).toBe(0);
    const out = JSON.parse(again.stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: FILE,
        status: "skipped",
        regions: [
          { region: "scripts.dev", status: "skipped" },
          { region: "scripts.deploy", status: "skipped" },
        ],
      },
    ]);
    expect(out.written).toEqual([]);
    const settled = (tree: Record<string, string>) => ({
      ...tree,
      "bg.json": (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"'),
    });
    expect(settled(await snapshot(target))).toEqual(settled(before));
  });

  test("a hand-edited region is user-owned: the re-add names it and writes nothing, and --force puts it back", async () => {
    const { target } = await installed("bg-cli-api-edit-", "cloudflare");
    const clean = await readFile(join(target, FILE), "utf8");
    await writeFile(join(target, FILE), clean.replace(DEV_CLOUDFLARE, "bun my-own-dev.ts"));
    const edited = await snapshot(target);

    const refused = await runBonneGarde(target, "add", "api/elysia", "--yes", "--no-install");

    expect(refused.code).toBe(1);
    // The region, as for a file the module only patches: not "apps/api/package.json was modified".
    expect(refused.stderr).toContain(
      `scripts.dev of ${FILE} is "bun my-own-dev.ts", which differs from what api/elysia declares ("${DEV_CLOUDFLARE}")`,
    );
    expect(refused.stderr).toContain("--force");
    expect(refused.stderr).not.toContain("was modified");
    expect(await snapshot(target)).toEqual(edited);

    const forced = await runBonneGarde(
      target,
      "add",
      "api/elysia",
      "--yes",
      "--no-install",
      "--force",
    );

    expect(forced.code).toBe(0);
    const regions = (JSON.parse(forced.stdout) as ModuleOutput).modules[0]?.patches[0]?.regions;
    expect(regions).toContainEqual({
      region: "scripts.dev",
      status: "applied",
      replaced: "bun my-own-dev.ts",
    });
    expect(await readFile(join(target, FILE), "utf8")).toBe(clean);
  });

  test("an edit outside the regions is not a conflict: the re-add keeps the file and says so, --force or not", async () => {
    const { target } = await installed("bg-cli-api-file-", "cloudflare");
    const clean = await readFile(join(target, FILE), "utf8");
    const body = JSON.parse(clean) as Record<string, unknown>;
    const edited = `${JSON.stringify({ ...body, license: "MIT" }, null, 2)}\n`;
    await writeFile(join(target, FILE), edited);

    for (const flags of [[], ["--force"]]) {
      const again = await runBonneGarde(
        target,
        "add",
        "api/elysia",
        "--yes",
        "--no-install",
        ...flags,
      );

      expect(again.code).toBe(0);
      const out = JSON.parse(again.stdout) as ModuleOutput;
      expect(out.kept).toEqual([FILE]);
      expect(out.written).toEqual([]);
      expect(out.modules[0]?.patches[0]?.status).toBe("skipped");
      expect(await readFile(join(target, FILE), "utf8")).toBe(edited);
    }
  });

  test("without a provider it fails naming the category, and without the config module it names that", async () => {
    const target = await freshProject("bg-cli-api-peers-");

    const noProvider = await runBonneGarde(
      target,
      "add",
      "config/branding",
      "api/elysia",
      "--no-install",
    );
    expect(noProvider.code).toBe(1);
    expect(noProvider.stderr).toContain(
      "api/elysia needs a module in category provider (any) and none is installed",
    );

    const noConfig = await runBonneGarde(
      target,
      "add",
      "provider/cloudflare",
      "api/elysia",
      "--no-install",
    );
    expect(noConfig.code).toBe(1);
    expect(noConfig.stderr).toContain(
      "api/elysia needs a module in category config (branding) and none is installed",
    );
    expect(await readdir(join(target, "apps"))).toEqual([".gitkeep"]);
  });
});

describe("bonne-garde add: package.dependencies (060)", () => {
  /** A registry of one module, `dev/wiring`, that adds the entries a module declares to the root package.json. */
  async function wiringRegistry(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "bg-cli-deps-reg-"));
    dirs.push(root);
    await mkdir(join(root, "registry/modules/dev/wiring"), { recursive: true });
    await writeFile(join(root, "registry/registry.json"), JSON.stringify({ name: "t", items: [] }));
    await writeFile(
      join(root, "registry/modules/dev/wiring/module.json"),
      JSON.stringify({
        id: "wiring",
        category: "dev",
        title: "Wiring",
        description: "Declares dependencies on the root package.json.",
        variants: [
          {
            key: "default",
            match: {},
            patch: [
              {
                type: "package.dependencies",
                file: "package.json",
                dependencies: { "{{SCOPE}}/db": "workspace:*", zod: "4.0.0" },
                devDependencies: { "drizzle-kit": "0.31.10" },
              },
            ],
          },
        ],
      }),
    );
    return `local:${join(root, "registry")}`;
  }

  async function projectWithWiring(prefix: string): Promise<string> {
    const parent = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(parent);
    return createProject({
      name: "cli-app",
      cwd: parent,
      git: false,
      install: false,
      registry: await wiringRegistry(),
    }).then(({ target }) => target);
  }

  const REGIONS = [
    { region: "dependencies.@cli-app/db", status: "applied" },
    { region: "dependencies.zod", status: "applied" },
    { region: "devDependencies.drizzle-kit", status: "applied" },
  ];

  test("each entry lands where the formatter sorts it, and the JSON says per region what the patch did", async () => {
    const target = await projectWithWiring("bg-cli-deps-");
    const before = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      devDependencies: Record<string, string>;
    };

    const { stdout, code } = await runBonneGarde(
      target,
      "add",
      "dev/wiring",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "package.dependencies",
        file: "package.json",
        status: "applied",
        regions: REGIONS,
      },
    ]);
    expect(out.failedPatches).toEqual([]);
    expect(out.written).not.toContain("package.json");

    const text = await readFile(join(target, "package.json"), "utf8");
    const after = JSON.parse(text) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // `{{SCOPE}}` is rendered in the name; the new `dependencies` map sits after `scripts`, and
    // `drizzle-kit` between `@types/node` and `husky`, which is where `vp fmt` has it.
    expect(after.dependencies).toEqual({ "@cli-app/db": "workspace:*", zod: "4.0.0" });
    expect(Object.keys(JSON.parse(text) as object).slice(-3)).toEqual([
      "scripts",
      "dependencies",
      "devDependencies",
    ]);
    expect(Object.keys(after.devDependencies)).toEqual([
      "@types/node",
      "drizzle-kit",
      "husky",
      "tsx",
      "typescript",
      "vite-plus",
    ]);
    expect(after.devDependencies).toMatchObject(before.devDependencies);

    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      regions: Record<string, Record<string, string>>;
    };
    expect(bg.regions["package.json"]).toEqual({
      "dependencies.@cli-app/db": "dev/wiring",
      "dependencies.zod": "dev/wiring",
      "devDependencies.drizzle-kit": "dev/wiring",
    });
    const doctor = await runBonneGarde(target, "doctor", "--strict");
    expect(doctor.code).toBe(0);
  });

  test("the same add again reports every region skipped, and the project is the same bytes", async () => {
    const target = await projectWithWiring("bg-cli-deps-twice-");
    await runBonneGarde(target, "add", "dev/wiring", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stdout, code } = await runBonneGarde(
      target,
      "add",
      "dev/wiring",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    expect((JSON.parse(stdout) as ModuleOutput).modules[0]?.patches).toEqual([
      {
        type: "package.dependencies",
        file: "package.json",
        status: "skipped",
        regions: REGIONS.map(({ region }) => ({ region, status: "skipped" })),
      },
    ]);
    const settled = (tree: Record<string, string>) => ({
      ...tree,
      "bg.json": (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"'),
    });
    expect(settled(await snapshot(target))).toEqual(settled(before));
  });

  test("a version the project changed is refused naming the region and --force, doctor warns, and --force puts it back", async () => {
    const target = await projectWithWiring("bg-cli-deps-edit-");
    await runBonneGarde(target, "add", "dev/wiring", "--yes", "--no-install");
    const clean = await readFile(join(target, "package.json"), "utf8");
    await writeFile(
      join(target, "package.json"),
      clean.replace('"zod": "4.0.0"', '"zod": "4.1.0"'),
    );
    const edited = await snapshot(target);

    const doctor = await runBonneGarde(target, "doctor", "--strict");
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain("region-foreign-edit");
    expect(doctor.stdout).toContain('dependencies.zod of package.json is "4.1.0"');

    const refused = await runBonneGarde(target, "add", "dev/wiring", "--yes", "--no-install");
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(
      'dependencies.zod of package.json is "4.1.0", which differs from what dev/wiring declares ("4.0.0")',
    );
    expect(refused.stderr).toContain("--force");
    expect(await snapshot(target)).toEqual(edited);

    const forced = await runBonneGarde(
      target,
      "add",
      "dev/wiring",
      "--yes",
      "--no-install",
      "--force",
    );

    expect(forced.code).toBe(0);
    expect((JSON.parse(forced.stdout) as ModuleOutput).modules[0]?.patches[0]).toEqual({
      type: "package.dependencies",
      file: "package.json",
      status: "applied",
      regions: [
        { region: "dependencies.@cli-app/db", status: "skipped" },
        { region: "dependencies.zod", status: "applied", replaced: '"4.1.0"' },
        { region: "devDependencies.drizzle-kit", status: "skipped" },
      ],
    });
    expect(await readFile(join(target, "package.json"), "utf8")).toBe(clean);
  });

  test("a package.json that cannot hold the entries is a failed patch and a pending intention, and the install completes", async () => {
    const target = await projectWithWiring("bg-cli-deps-failed-");
    const root = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify({ ...root, dependencies: ["zod"] }, null, 2)}\n`,
    );

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "dev/wiring",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const id = "dev/wiring/patch-package-dependencies-package-json-dependencies-cli-app-db";
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "package.dependencies",
        file: "package.json",
        status: "failed",
        reason: 'package.json: "dependencies" is an array, not an object',
        intention: id,
        regions: [],
      },
    ]);
    expect(out.pendingIntentions.map((pending) => pending.id)).toEqual([id]);
    expect(stderr).toContain(
      "bonne-garde: PATCH FAILED package.dependencies on package.json (dev/wiring)",
    );
  });
});

describe("bonne-garde add: an installed module is selected again when a module its variants match on is added (050 step 7, 035 Variants)", () => {
  const ID = "email/resend/wire-email-into-auth";
  /** What email needs and what auth needs but email: so that auth comes second. */
  const BASE = [
    "provider/cloudflare",
    "config/branding",
    "api/elysia",
    "db/d1",
    "orm/drizzle",
    "email/resend",
  ];

  async function emailFirst(prefix: string): Promise<string> {
    const target = await freshProject(prefix);
    const base = await runBonneGarde(target, "add", ...BASE, "--yes", "--no-install");
    expect(base.code).toBe(0);
    const out = JSON.parse(base.stdout) as ModuleOutput;
    expect(out.modules.find(({ module }) => module === "email/resend")?.variant).toBe("default");
    expect(out.reselected).toEqual([]);
    expect(out.pendingIntentions).toEqual([]);
    return target;
  }

  const emailRecord = async (target: string) =>
    (
      JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
        modules: { email: { variant: string }[] };
      }
    ).modules.email[0];

  test("auth added after email plans email again, on its better-auth variant, in the same plan, and stages the wiring", async () => {
    const target = await emailFirst("bg-cli-reselect-");

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "auth/better-auth",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.reselected).toEqual([
      { module: "email/resend", from: "default", to: "better-auth", because: ["auth/better-auth"] },
    ]);
    expect(stderr).toContain(
      "bonne-garde: email/resend, installed on variant default, is planned again on variant better-auth, which matches auth/better-auth",
    );
    expect(out.modules.map(({ module, variant }) => [module, variant])).toEqual([
      ["auth/better-auth", "default"],
      ["email/resend", "better-auth"],
    ]);
    // The patch that declares the email package in auth's package.json lands in the same apply,
    // on the file auth writes in this very call.
    expect(out.modules.find(({ module }) => module === "email/resend")?.patches).toMatchObject([
      { type: "package.dependencies", file: "packages/auth/package.json", status: "applied" },
    ]);
    expect(await readFile(join(target, "packages/auth/package.json"), "utf8")).toContain(
      '"@cli-app/email": "workspace:*"',
    );
    expect(out.pendingIntentions.map(({ id, staged }) => [id, staged])).toEqual([
      [ID, ".bg/add/01-wire-email-into-auth.md"],
    ]);
    expect(await readFile(join(target, ".bg/add/session.md"), "utf8")).toContain(ID);
    expect((await emailRecord(target))?.variant).toBe("better-auth");
  });

  test("--dry-run reports it too, and writes nothing", async () => {
    const target = await emailFirst("bg-cli-reselect-dry-");
    const before = await snapshot(target);

    const { stdout, code } = await runBonneGarde(
      target,
      "add",
      "auth/better-auth",
      "--dry-run",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.reselected.map(({ module, to }) => [module, to])).toEqual([
      ["email/resend", "better-auth"],
    ]);
    expect(out.pendingIntentions.map(({ id }) => id)).toEqual([ID]);
    expect(await snapshot(target)).toEqual(before);
  });

  test("once planned again it stays so: auth added again, or email alone, selects nothing and changes nothing", async () => {
    const target = await emailFirst("bg-cli-reselect-again-");
    await runBonneGarde(target, "add", "auth/better-auth", "--yes", "--no-install");

    // A re-add moves `installedAt` in bg.json and nothing else.
    const tree = async () => {
      const { "bg.json": _manifest, ...files } = await snapshot(target);
      return files;
    };
    for (const name of ["auth/better-auth", "email/resend"]) {
      const before = await tree();
      const again = await runBonneGarde(target, "add", name, "--yes", "--no-install");
      expect(again.code).toBe(0);
      expect((JSON.parse(again.stdout) as ModuleOutput).reselected).toEqual([]);
      expect(await tree()).toEqual(before);
    }
    expect((await emailRecord(target))?.variant).toBe("better-auth");
  });

  describe("--force reaches what the call names, and a planned-again module is not one of those", () => {
    /** `emailFirst`, then a line of the project's own in a file of email that auth's variant writes again. */
    async function emailEdited(prefix: string): Promise<{ target: string; file: string }> {
      const target = await emailFirst(prefix);
      const file = join(target, "packages/email/src/send.ts");
      await writeFile(file, `${await readFile(file, "utf8")}// the project's own\n`);
      return { target, file };
    }
    const commandIn = (stderr: string) =>
      stderr.split("\n").find((line) => /^ {2}npx bonne-garde add /.test(line));

    test("the error names the module, who added it, and a command that names it in the same call; that command succeeds", async () => {
      const { target, file } = await emailEdited("bg-cli-reselect-force-");
      // A file of auth the project wrote before: auth is named, so --force overwrites it.
      const mine = join(target, "packages/auth/src/base-path.ts");
      await mkdir(join(mine, ".."), { recursive: true });
      await writeFile(mine, "// the project's own\n");
      const before = await snapshot(target);

      const refused = await runBonneGarde(
        target,
        "add",
        "auth/better-auth",
        "--force",
        "--yes",
        "--no-install",
      );

      expect(refused.code).toBe(1);
      expect(refused.stdout).toBe("");
      expect(refused.stderr).toContain(
        "email/resend, installed on variant default, is planned again on variant better-auth because auth/better-auth is added, and --force reaches only what the call names",
      );
      expect(refused.stderr).toContain(
        "packages/email/src/send.ts was modified since email/resend wrote it",
      );
      expect(refused.stderr).not.toContain("base-path.ts");
      expect(await snapshot(target)).toEqual(before);
      const command = commandIn(refused.stderr);
      expect(command).toBe(
        "  npx bonne-garde add auth/better-auth --yes --no-install email/resend --force",
      );

      const [npx, bonneGarde, ...args] = (command ?? "").trim().split(" ");
      expect([npx, bonneGarde]).toEqual(["npx", "bonne-garde"]);
      const resolved = await runBonneGarde(target, ...args);

      expect(resolved.stderr).not.toContain("is already filled");
      expect(resolved.code).toBe(0);
      expect(await readFile(file, "utf8")).not.toContain("the project's own");
      expect(await readFile(mine, "utf8")).not.toContain("the project's own");
      const out = JSON.parse(resolved.stdout) as ModuleOutput;
      // Named in the call, email is a requested module and not a planned-again one.
      expect(out.reselected).toEqual([]);
      expect(out.modules.map(({ module, variant }) => [module, variant])).toEqual([
        ["auth/better-auth", "default"],
        ["email/resend", "better-auth"],
      ]);
      expect((await emailRecord(target))?.variant).toBe("better-auth");
    });

    test("without --force it is the same refusal, and the command is the one the user would have typed with the module named", async () => {
      const { target } = await emailEdited("bg-cli-reselect-noforce-");
      const before = await snapshot(target);

      const refused = await runBonneGarde(target, "add", "auth/better-auth");

      expect(refused.code).toBe(1);
      expect(refused.stderr).not.toContain("(use --force to overwrite)");
      expect(commandIn(refused.stderr)).toBe(
        "  npx bonne-garde add auth/better-auth email/resend --force",
      );
      expect(await snapshot(target)).toEqual(before);
    });
  });

  test("naming both in one call needs no re-selection: it is the plan that call is", async () => {
    const target = await freshProject("bg-cli-reselect-both-");
    await runBonneGarde(
      target,
      "add",
      ...BASE.filter((name) => name !== "email/resend"),
      "--yes",
      "--no-install",
    );

    const { stdout } = await runBonneGarde(
      target,
      "add",
      "email/resend",
      "auth/better-auth",
      "--yes",
      "--no-install",
    );

    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.reselected).toEqual([]);
    expect(out.modules.find(({ module }) => module === "email/resend")?.variant).toBe(
      "better-auth",
    );
  });
});

describe("bonne-garde add: the intentions a module authors (065)", () => {
  const ID = "dev/launcher/wire-launcher";
  const DOCUMENT = `---\nid: ${ID}\nkind: install\ndomain: dev\nclassification: migration\n---\n\n# Start the app through {{SCOPE}}/launcher\n\n## Goal\n\nImport {{SCOPE}}/launcher.\n`;

  /** A registry of one module, `dev/launcher`, whose variant ships one intention and has nothing else to write. */
  async function launcherRegistry(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "bg-cli-intent-reg-"));
    dirs.push(root);
    const dir = join(root, "registry/modules/dev/launcher");
    await mkdir(join(dir, "intent"), { recursive: true });
    await writeFile(join(root, "registry/registry.json"), JSON.stringify({ name: "t", items: [] }));
    await writeFile(
      join(dir, "module.json"),
      JSON.stringify({
        id: "launcher",
        category: "dev",
        title: "Launcher",
        description: "Ships an intention.",
        checks: ["bun run typecheck"],
        variants: [{ key: "default", match: {}, intent: ["01-wire-launcher.md"] }],
      }),
    );
    await writeFile(join(dir, "intent/01-wire-launcher.md"), DOCUMENT);
    return `local:${join(root, "registry")}`;
  }

  async function projectWithLauncher(): Promise<string> {
    const parent = await mkdtemp(join(tmpdir(), "bg-cli-intent-"));
    dirs.push(parent);
    return createProject({
      name: "cli-app",
      cwd: parent,
      git: false,
      install: false,
      registry: await launcherRegistry(),
    }).then(({ target }) => target);
  }

  test("is staged as written with the scope rendered, reported by doctor, and closed by bonne-garde record", async () => {
    const target = await projectWithLauncher();

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "dev/launcher",
      "--yes",
      "--no-install",
    );

    // The install completes: the intention is part of it, not a failure of it.
    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.pendingIntentions).toEqual([
      {
        id: ID,
        module: "dev/launcher",
        type: null,
        file: null,
        intent: "Start the app through @cli-app/launcher",
        reason: null,
        staged: ".bg/add/01-wire-launcher.md",
      },
    ]);
    expect(out.session).toBe(".bg/add/session.md");
    expect(out.failedPatches).toEqual([]);
    expect(stderr).toContain("bonne-garde: 1 pending intention: read .bg/add/session.md");
    expect(stderr).toContain("checks withheld while 1 intention is pending");
    expect(await readFile(join(target, ".bg/add/01-wire-launcher.md"), "utf8")).toBe(
      DOCUMENT.replaceAll("{{SCOPE}}", "@cli-app"),
    );
    expect(await readFile(join(target, ".bg/add/session.md"), "utf8")).toContain(ID);

    // doctor names it, and --strict fails on it: it is pending work, not a clean install.
    const pending = await runBonneGarde(target, "doctor", "--strict");
    expect(pending.code).toBe(1);
    expect(pending.stdout).toContain(
      `${ID} is staged in .bg/add/01-wire-launcher.md and not recorded`,
    );

    // The same add again stages the same bytes.
    const before = await snapshot(target);
    const again = await runBonneGarde(target, "add", "dev/launcher", "--yes", "--no-install");
    expect(again.code).toBe(0);
    expect((await snapshot(target))[".bg/add/01-wire-launcher.md"]).toBe(
      before[".bg/add/01-wire-launcher.md"],
    );

    // bonne-garde record closes it: doctor is green and a later add does not raise it again.
    expect((await runBonneGarde(target, "record", ID)).code).toBe(0);
    expect((await runBonneGarde(target, "doctor", "--strict")).code).toBe(0);
    const last = await runBonneGarde(target, "add", "dev/launcher", "--yes", "--no-install");
    expect(last.code).toBe(0);
    expect((JSON.parse(last.stdout) as ModuleOutput).pendingIntentions).toEqual([]);
    expect(last.stderr).not.toContain("pending intention");
  });

  test("bonne-garde record reads the module's own document once .bg/ is gone, so it needs no second add", async () => {
    const target = await projectWithLauncher();
    await runBonneGarde(target, "add", "dev/launcher", "--yes", "--no-install");
    await rm(join(target, ".bg"), { recursive: true });

    const recorded = await runBonneGarde(target, "record", ID);

    expect(recorded.code).toBe(0);
    expect(recorded.stderr).toContain("not staged");
    expect((await runBonneGarde(target, "doctor", "--strict")).code).toBe(0);
  });

  test("bonne-garde record refuses once .bg/ is gone and the registry cannot give the document, and the add the refusal names stages the intention again", async () => {
    const target = await projectWithLauncher();
    await runBonneGarde(target, "add", "dev/launcher", "--yes", "--no-install");
    await rm(join(target, ".bg"), { recursive: true });
    const before = await readFile(join(target, "bg.json"), "utf8");
    const unreachable = `${JSON.stringify(
      {
        ...(JSON.parse(before) as Record<string, unknown>),
        registries: { "@bg": "local:./nowhere" },
      },
      null,
      2,
    )}\n`;
    await writeFile(join(target, "bg.json"), unreachable);

    const refused = await runBonneGarde(target, "record", ID);

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("the registry gave none");
    expect(refused.stderr).toContain("bonne-garde add dev/launcher");
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(unreachable);

    // The registry is back and the intention is still pending, so that add stages it again, and then it records.
    await writeFile(join(target, "bg.json"), before);
    const again = await runBonneGarde(target, "add", "dev/launcher", "--yes", "--no-install");
    expect(again.code).toBe(0);
    expect(await readFile(join(target, ".bg/add/01-wire-launcher.md"), "utf8")).toBe(
      DOCUMENT.replaceAll("{{SCOPE}}", "@cli-app"),
    );
    expect((await runBonneGarde(target, "record", ID)).code).toBe(0);
    expect((await runBonneGarde(target, "doctor", "--strict")).code).toBe(0);
  });

  test("--dry-run reports it with nothing staged", async () => {
    const target = await projectWithLauncher();
    const before = await snapshot(target);

    const { stdout, stderr, code } = await runBonneGarde(
      target,
      "add",
      "dev/launcher",
      "--dry-run",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.pendingIntentions.map(({ id, staged }) => [id, staged])).toEqual([[ID, null]]);
    expect(out.session).toBeNull();
    expect(stderr).not.toContain("read .bg/add/session.md");
    expect(await snapshot(target)).toEqual(before);
  });
});

describe("bonne-garde intentions lint: the intentions modules author (065)", () => {
  const emptyMigrations = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "bg-cli-lint-mig-"));
    dirs.push(dir);
    return dir;
  };

  /** A registry whose one module, `dev/launcher`, ships `intent/01-wire-launcher.md` with the given id. */
  async function registryWithIntention(id: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "bg-cli-lint-reg-"));
    dirs.push(root);
    const dir = join(root, "modules/dev/launcher");
    await mkdir(join(dir, "intent"), { recursive: true });
    await writeFile(
      join(dir, "module.json"),
      JSON.stringify({
        id: "launcher",
        category: "dev",
        title: "Launcher",
        description: "Ships an intention.",
        variants: [{ key: "default", match: {}, intent: ["01-wire-launcher.md"] }],
      }),
    );
    const sections = [
      "Goal",
      "Why",
      "Applies When",
      "Do Not Apply When",
      "Observable Gaps",
      "Out of Scope",
      "Reference Paths",
      "Validation",
      "Record Result",
    ]
      .map((name) => `## ${name}\n\n${name === "Reference Paths" ? "- `adapt` `a.ts`" : "x"}\n`)
      .join("\n");
    await writeFile(
      join(dir, "intent/01-wire-launcher.md"),
      `---\nid: ${id}\nkind: install\ndomain: dev\nclassification: migration\n---\n\n# Wire\n\n${sections}`,
    );
    return root;
  }

  test("lints the registry beside the migrations, and lists the intentions of each module", async () => {
    const registry = await registryWithIntention("dev/launcher/wire-launcher");

    const { stdout, code } = await runBonneGarde(
      await emptyMigrations(),
      "intentions",
      "lint",
      "--dir",
      await emptyMigrations(),
      "--registry",
      registry,
    );

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      releases: [],
      modules: [{ module: "dev/launcher", intentions: ["dev/launcher/wire-launcher"] }],
    });
  });

  test("fails on a module's intention that breaks the format, naming the module and the file", async () => {
    const registry = await registryWithIntention("dev/launcher/other");

    const { stderr, code } = await runBonneGarde(
      await emptyMigrations(),
      "intentions",
      "lint",
      "--dir",
      await emptyMigrations(),
      "--registry",
      registry,
    );

    expect(code).toBe(1);
    expect(stderr).toContain(
      "dev/launcher: 01-wire-launcher.md: id must be dev/launcher/wire-launcher, got dev/launcher/other",
    );
  });

  test("with no flag it lints this repository's own migrations and registry, which is what verify runs", async () => {
    const { stdout, code } = await runBonneGarde(repoRoot(), "intentions", "lint");

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      releases: [],
      modules: expect.any(Array),
    });
  });
});

describe("bg create with choices (040)", () => {
  const registry = () => `local:${join(repoRoot(), "registry")}`;

  test("adds what the flags name, and reports what the add left pending as bg add does", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-choices-")));
    dirs.push(parent);

    const { stdout, stderr, code } = await runBonneGarde(
      parent,
      "create",
      "app",
      "--apps",
      "api,spa,ssr,static",
      "--features",
      "db,auth,storage,email,deploy,backoffice",
      "--yes",
      "--no-git",
      "--no-install",
      "--registry",
      registry(),
    );

    expect(code).toBe(0);
    expect(stdout).toContain(
      `created ${join(parent, "app")} with api, spa, ssr, static on cloudflare`,
    );
    // --no-install: the line says what is left to do, not that it was installed.
    expect(stdout).toContain("not installed: run `bun install` in it");
    expect(stdout).not.toContain("installed with");
    expect(stderr).toContain("pending intention");
    expect(stderr).toContain("read .bg/add/session.md");
    const bg = JSON.parse(await readFile(join(parent, "app", "bg.json"), "utf8")) as {
      modules: Record<string, unknown>;
    };
    expect(Object.keys(bg.modules)).toContain("deploy");
  });

  test("takes --provider, and leaves out what no answer names", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-choices-")));
    dirs.push(parent);

    const { code } = await runBonneGarde(
      parent,
      "create",
      "app",
      "--apps",
      "api",
      "--provider",
      "dockerfile",
      "--yes",
      "--no-git",
      "--no-install",
      "--registry",
      registry(),
    );

    expect(code).toBe(0);
    const bg = JSON.parse(await readFile(join(parent, "app", "bg.json"), "utf8")) as {
      modules: Record<string, { id: string }[]>;
    };
    expect(bg.modules.provider?.map(({ id }) => id)).toEqual(["dockerfile"]);
    expect(bg.modules).not.toHaveProperty("web");
    expect(bg.modules).not.toHaveProperty("ui");
  });

  test("refuses a set the planner refuses with its message, and writes nothing", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-choices-")));
    dirs.push(parent);

    const { stderr, code } = await runBonneGarde(
      parent,
      "create",
      "app",
      "--apps",
      "ssr",
      "--provider",
      "dockerfile",
      "--yes",
      "--registry",
      registry(),
    );

    expect(code).toBe(1);
    expect(stderr).toContain("web/ssr accepts only cloudflare for provider");
    expect(await readdir(parent)).toEqual([]);
  });

  test("refuses features with no app, and an unknown value naming the flag", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-choices-")));
    dirs.push(parent);

    const noApp = await runBonneGarde(parent, "create", "app", "--features", "auth", "--yes");
    expect(noApp.code).toBe(1);
    expect(noApp.stderr).toContain("--provider and --features need an app (--apps)");

    const unknown = await runBonneGarde(parent, "create", "app", "--apps", "api,web", "--yes");
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("--apps: unknown value web");
    expect(await readdir(parent)).toEqual([]);
  });

  test("--help and -h print the usage and create nothing; an unknown option is refused, never taken for a directory", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-choices-")));
    dirs.push(parent);

    for (const flag of ["--help", "-h"]) {
      const help = await runBonneGarde(parent, "create", flag);
      expect(help.code).toBe(0);
      expect(help.stdout).toContain("bonne-garde create");
    }
    const unknown = await runBonneGarde(parent, "create", "--bogus", "--yes", "--no-install");
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("create: unknown option --bogus");
    expect(await readdir(parent)).toEqual([]);
  });

  test("reads a relative local registry from where it runs, and the project records it absolute", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-choices-")));
    dirs.push(parent);
    const absolute = join(repoRoot(), "registry");

    const { stderr, code } = await runBonneGarde(
      parent,
      "create",
      "app",
      "--apps",
      "api",
      "--provider",
      "dockerfile",
      "--yes",
      "--no-git",
      "--no-install",
      "--registry",
      `local:${relative(parent, absolute)}`,
    );

    expect(stderr).not.toContain("ENOENT");
    expect(code).toBe(0);
    const bg = JSON.parse(await readFile(join(parent, "app", "bg.json"), "utf8")) as {
      registries: Record<string, string>;
    };
    expect(bg.registries["@bg"]).toBe(`local:${absolute}`);
  });

  test("without a TTY and without flags, creates the base and its package manager without asking", async () => {
    const parent = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-choices-")));
    dirs.push(parent);

    const { stdout, code } = await runBonneGarde(
      parent,
      "create",
      "app",
      "--no-git",
      "--no-install",
      "--registry",
      registry(),
    );

    expect(code).toBe(0);
    // The base and the package manager `create` was started from, which every project has (040).
    expect(stdout).toContain(`created ${join(parent, "app")} with bun\n`);
    const bg = JSON.parse(await readFile(join(parent, "app", "bg.json"), "utf8")) as {
      modules: Record<string, { id: string }[]>;
    };
    expect(Object.keys(bg.modules)).toEqual(["pm"]);
    expect(bg.modules.pm?.map(({ id }) => id)).toEqual(["bun"]);
  });
});
