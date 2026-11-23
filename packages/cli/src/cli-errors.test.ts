import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "./cli";
import { packageRoot } from "./paths";

const dirs: string[] = [];
const cwd = process.cwd();

afterEach(async () => {
  process.chdir(cwd);
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Runs the CLI in-process and collects what it printed. */
async function run(argv: string[], inDir?: string) {
  const out: string[] = [];
  const err: string[] = [];
  const log = spyOn(console, "log").mockImplementation(
    (...parts) => void out.push(parts.join(" ")),
  );
  const error = spyOn(console, "error").mockImplementation(
    (...parts) => void err.push(parts.join(" ")),
  );
  if (inDir) {
    process.chdir(inDir);
  }
  try {
    const code = await runCli(argv);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
}

async function emptyDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bg-cli-errors-")));
  dirs.push(dir);
  return dir;
}

describe("errors", () => {
  test("an unknown command prints the error and the nearest command, never the help", async () => {
    const { code, stderr, stdout } = await run(["lst"]);
    expect(code).toBe(1);
    expect(stderr).toContain("✖ Unknown command: lst");
    expect(stderr).toContain("Did you mean: list?");
    expect(stderr).toContain("bonne-garde --help");
    expect(stderr).not.toContain("Compose");
    expect(stdout).toBe("");
  });

  test("an unknown flag fails with the nearest flag of the command", async () => {
    const { code, stderr } = await run(["list", "--itmes"]);
    expect(code).toBe(1);
    expect(stderr).toContain("✖ Unknown flag: --itmes");
    expect(stderr).toContain("Did you mean: --items?");
    expect(stderr).not.toContain("Compose");
  });

  test("add outside a project says so, with no ENOENT", async () => {
    const { code, stderr } = await run(["add", "button"], await emptyDir());
    expect(code).toBe(1);
    expect(stderr).toContain("✖ Not a Bonne Garde project");
    expect(stderr).toContain("No bg.json in ");
    expect(stderr).toContain("Create one: bonne-garde create <dir>");
    expect(stderr).not.toContain("ENOENT");
  });

  test("record and doctor outside a project say so", async () => {
    const dir = await emptyDir();
    for (const argv of [["record", "v0.2.0/x"], ["doctor"]]) {
      const { code, stderr } = await run(argv, dir);
      expect(code).toBe(1);
      expect(stderr).toContain("✖ Not a Bonne Garde project");
    }
  });

  test("doctor --json outside a project keeps its report", async () => {
    const { code, stdout } = await run(["doctor", "--json"], await emptyDir());
    expect(code).toBe(1);
    expect(JSON.parse(stdout).checks.manifest.findings[0].code).toBe("manifest-missing");
  });
});

describe("help and version", () => {
  test("add --help prints the add usage and not the create one", async () => {
    for (const flag of ["--help", "-h"]) {
      const { code, stdout } = await run(["add", flag]);
      expect(code).toBe(0);
      expect(stdout).toContain("bonne-garde add <name...>");
      expect(stdout).not.toContain("bonne-garde create");
      expect(stdout).not.toContain("bonne-garde doctor");
    }
  });

  test("the global help still lists every command", async () => {
    const { stdout } = await run(["--help"]);
    for (const name of [
      "create",
      "add",
      "list",
      "search",
      "view",
      "doctor",
      "record",
      "intentions",
    ]) {
      expect(stdout).toContain(`bonne-garde ${name}`);
    }
  });

  test("--version prints the version of package.json", async () => {
    const pkg = (await Bun.file(join(packageRoot(), "package.json")).json()) as { version: string };
    const { code, stdout } = await run(["--version"]);
    expect(code).toBe(0);
    expect(stdout).toBe(pkg.version);
  });
});
