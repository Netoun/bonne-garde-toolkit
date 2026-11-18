import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addItems, namesChecker } from "./add";
import { APPS, CANDIDATE_MODULES, FEATURES, namesFor, PROVIDERS, type Choices } from "./choices";
import { createProject } from "./create";
import { PACKAGE_MANAGERS } from "./package-manager";
import { findRepoRoot } from "./paths";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function subsets<T>(values: readonly T[]): T[][] {
  return values.reduce<T[][]>((all, value) => all.concat(all.map((set) => [...set, value])), [[]]);
}

/** Every answer set `create` can be given with an app: each axis, every combination. */
function everyAnswerSet(): Choices[] {
  return subsets(APPS)
    .filter((apps) => apps.length > 0)
    .flatMap((apps) =>
      PACKAGE_MANAGERS.flatMap((pm) =>
        PROVIDERS.flatMap((provider) =>
          subsets(FEATURES).map((features) => ({ apps, provider, features, pm })),
        ),
      ),
    );
}

// 070: what the registry accepts, `create` must be able to add. A set the check accepts and the
// add then refuses, or patches with a failure, is a project `create` would leave half made.
test("every answer set the registry accepts is planned in a fresh project, with no failed patch", async () => {
  const root = findRepoRoot();
  if (!root) {
    throw new Error("repo root not found");
  }
  const registry = `local:${join(root, "registry")}`;
  const parent = await mkdtemp(join(tmpdir(), "bg-cli-matrix-"));
  dirs.push(parent);
  const { target } = await createProject({
    name: "matrix",
    cwd: parent,
    git: false,
    install: false,
    registry,
  });
  const check = await namesChecker(registry, parent, CANDIDATE_MODULES);

  const accepted = everyAnswerSet().filter((choices) => {
    const { modules, items } = namesFor(choices);
    try {
      check([...modules, ...items]);
      return true;
    } catch {
      return false;
    }
  });
  expect(accepted.length).toBeGreaterThan(0);

  const failures: string[] = [];
  for (const choices of accepted) {
    const { modules, items } = namesFor(choices);
    const added = await addItems({
      projectRoot: target,
      items: [...modules, ...items],
      dryRun: true,
      install: false,
    }).catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
    const failed =
      typeof added === "string"
        ? added
        : added.result.patches
            .filter((patch) => patch.status === "failed")
            .map(({ file, reason }) => `${file}: ${reason}`)
            .join("; ");
    if (failed) {
      failures.push(`${JSON.stringify(choices)}: ${failed}`);
    }
  }
  expect(failures).toEqual([]);
}, 120_000);
