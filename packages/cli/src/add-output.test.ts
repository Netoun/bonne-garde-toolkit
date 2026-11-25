import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { addItems } from "./add";
import { createProject } from "./create";
import { clackErrorText } from "./errors";
import { findRepoRoot } from "./paths";
import { addPhases, showAdd } from "./terminal";

const dirs: string[] = [];
const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length > 0) {
    restores.pop()?.();
  }
});

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshProject(): Promise<string> {
  const root = findRepoRoot();
  if (!root) {
    throw new Error("repo root not found");
  }
  const parent = await mkdtemp(join(tmpdir(), "bg-add-output-"));
  dirs.push(parent);
  const { target } = await createProject({
    name: "out-app",
    cwd: parent,
    git: false,
    install: false,
    registry: `local:${join(root, "registry")}`,
    names: ["pm/bun", "ui/shadcn"],
  });
  return target;
}

/** Puts a `bun` that exits with `code` first on PATH: the install is the step under test, not the network. */
async function fakeBun(code: number): Promise<void> {
  const bin = await mkdtemp(join(tmpdir(), "bg-fake-bun-"));
  dirs.push(bin);
  await writeFile(
    join(bin, "bun"),
    `#!/bin/sh\n${code === 0 ? "" : "echo boom >&2\n"}exit ${code}\n`,
  );
  await chmod(join(bin, "bun"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${path ?? ""}`;
  restores.push(() => {
    process.env.PATH = path;
  });
}

/** Everything the terminal output writes while `run` runs, with the colors stripped. */
async function captured(run: () => void | Promise<void>): Promise<string> {
  let out = "";
  const write = (chunk: unknown) => {
    out += String(chunk);
    return true;
  };
  const stdout = spyOn(process.stdout, "write").mockImplementation(write as never);
  const log = spyOn(console, "log").mockImplementation(((...args: unknown[]) => {
    out += `${args.join(" ")}\n`;
  }) as never);
  restores.push(
    () => stdout.mockRestore(),
    () => log.mockRestore(),
  );
  try {
    await run();
  } finally {
    stdout.mockRestore();
    log.mockRestore();
  }
  return stripVTControlCharacters(out);
}

describe("showAdd", () => {
  test("lists the files written and the npm packages a sidebar needs", async () => {
    const projectRoot = await freshProject();
    await fakeBun(0);
    const outcome = await addItems({ projectRoot, items: ["sidebar"], installOutput: "capture" });
    const out = await captured(() => showAdd(outcome, false, "bun"));
    expect(out).toContain("sidebar");
    expect(out).toContain("it needs: ");
    expect(out).toContain("packages/ui/src/");
    expect(out).toMatch(/… \d+ more under packages\/ui\/src/);
    expect(outcome.plan.npmDependencies.length).toBeGreaterThan(0);
    for (const name of outcome.plan.npmDependencies) {
      expect(out).toContain(name);
    }
    expect(out).toContain("Installed: ");
  });

  test("a dry run says what it would write, never that anything was applied", async () => {
    const projectRoot = await freshProject();
    const outcome = await addItems({
      projectRoot,
      items: ["sidebar"],
      install: false,
      dryRun: true,
    });
    const out = await captured(() => showAdd(outcome, true, "bun"));
    expect(out).toContain("would write");
    expect(out).not.toContain("applied");
  });

  test("a name already installed and unchanged says so instead of adding it again", async () => {
    const projectRoot = await freshProject();
    await addItems({ projectRoot, items: ["sidebar"], install: false });
    const outcome = await addItems({ projectRoot, items: ["sidebar"], install: false });
    const out = await captured(() => showAdd(outcome, false, "bun"));
    expect(out).toContain("sidebar is already installed: nothing to do");
  });

  test("prints the checks to run as plain lines, with no box border to copy", async () => {
    const projectRoot = await freshProject();
    const outcome = await addItems({ projectRoot, items: ["tooling/vite-plus"], install: false });
    const out = await captured(() => showAdd(outcome, false, "bun"));
    const line = out.split("\n").find((candidate) => candidate.includes("vp run check"));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/[│┃║]/);
  });
});

describe("addPhases", () => {
  test("a failing install reports the install step by name", async () => {
    const projectRoot = await freshProject();
    await fakeBun(1);

    let failure: unknown;
    await captured(async () => {
      await addItems({
        projectRoot,
        items: ["sidebar"],
        installOutput: "capture",
        phase: addPhases(["sidebar"], false, "bun"),
      }).catch((error: unknown) => {
        failure = error;
      });
    });
    const text = stripVTControlCharacters(clackErrorText(failure));
    expect(text).toMatch(/Installing \d+ packages with bun failed/);
    expect(text).toContain("boom");
  });
});
