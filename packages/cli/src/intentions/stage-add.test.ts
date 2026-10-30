import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PendingIntention } from "@bonne-garde/registry";
import { parseFrontmatter } from "./lint";
import { intentionDocument, sessionDocument, stagePendingIntentions } from "./stage-add";
import { readStagedIntentions } from "./staged";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bg-stage-add-"));
  dirs.push(root);
  return root;
}

const ID = "auth/better-auth/patch-ts-elysia-use-apps-api-src-app-ts-elysia-app-use-auth-module";
const pending = (overrides: Partial<PendingIntention> = {}): PendingIntention => ({
  id: ID,
  module: "auth/better-auth",
  type: "ts.elysiaUse",
  file: "apps/api/src/app.ts",
  intent: "Register the auth plugin on the API, above its routes.",
  reason: "apps/api/src/app.ts does not exist",
  gaps: ["elysia[app].use[authModule] of apps/api/src/app.ts is .use(authModule)"],
  checks: ["cd apps/api && bun run typecheck && bun run test"],
  ...overrides,
});
const other = () =>
  pending({
    id: "auth/better-auth/patch-ts-add-import-apps-api-src-app-ts-imports-app-auth",
    type: "ts.addImport",
    gaps: ["imports[@app/auth] of apps/api/src/app.ts is { authModule }"],
  });

describe("the intention a failed patch becomes (065)", () => {
  test("is a document the intention parser reads: id, kind, domain, classification", () => {
    const document = intentionDocument(pending());

    expect(parseFrontmatter(document)).toEqual({
      id: ID,
      kind: "install",
      domain: "auth",
      classification: "migration",
    });
  });

  test("carries the intent, the target file, the reason, the gaps and the way to record it", () => {
    const document = intentionDocument(pending());

    for (const section of [
      "## Goal",
      "## Why",
      "## Applies When",
      "## Do Not Apply When",
      "## Observable Gaps",
      "## Out of Scope",
      "## Reference Paths",
      "## Validation",
      "## Record Result",
    ]) {
      expect(document).toContain(section);
    }
    expect(document).toContain("Register the auth plugin on the API, above its routes.");
    expect(document).toContain("apps/api/src/app.ts does not exist");
    expect(document).toContain("- `adapt` `apps/api/src/app.ts`");
    expect(document).toContain(
      "- elysia[app].use[authModule] of apps/api/src/app.ts is .use(authModule)",
    );
    expect(document).toContain("cd apps/api && bun run typecheck && bun run test");
    expect(document).toContain(`bg record ${ID}`);
    expect(document).toContain(`bg record ${ID} --skip "<reason>"`);
  });

  test("is the same text every time, so staging twice changes no byte", () => {
    expect(intentionDocument(pending())).toBe(intentionDocument(pending()));
  });
});

describe("the executor entry point (065)", () => {
  test("is the protocol, then the checklist in order, each item an id and its file", () => {
    const session = sessionDocument([
      { id: ID, file: ".bg/add/01-patch-a.md" },
      { id: "auth/better-auth/patch-b", file: ".bg/add/02-patch-b.md" },
    ]);

    expect(session).toContain("propose apply or skip");
    expect(session).toContain("blocked.md");
    expect(session.indexOf(`- [ ] \`.bg/add/01-patch-a.md\` — \`${ID}\``)).toBeGreaterThan(-1);
    expect(session.indexOf("01-patch-a.md")).toBeLessThan(session.indexOf("02-patch-b.md"));
  });
});

describe("stagePendingIntentions", () => {
  test("writes NN-<slug>.md per intention, in order, and a session.md that lists them", async () => {
    const root = await project();

    const staged = await stagePendingIntentions(root, [pending(), other()], new Set());

    const slugOf = (id: string) => id.split("/").at(-1);
    expect(staged).toEqual({
      session: ".bg/add/session.md",
      files: [
        { id: ID, file: `.bg/add/01-${slugOf(ID)}.md` },
        { id: other().id, file: `.bg/add/02-${slugOf(other().id)}.md` },
      ],
    });
    expect((await readdir(join(root, ".bg/add"))).sort()).toEqual([
      `01-${slugOf(ID)}.md`,
      `02-${slugOf(other().id)}.md`,
      "session.md",
    ]);
    expect(await readFile(join(root, ".bg/add/session.md"), "utf8")).toContain(
      `\`.bg/add/02-${slugOf(other().id)}.md\``,
    );
    // The reader that `doctor` and `record` use finds both, by id.
    expect((await readStagedIntentions(root)).staged.map(({ id }) => id)).toEqual([ID, other().id]);
  });

  test("staging the same again is the same bytes, and an intention keeps its file name", async () => {
    const root = await project();
    await stagePendingIntentions(root, [pending(), other()], new Set());
    const read = async () =>
      Object.fromEntries(
        await Promise.all(
          (await readdir(join(root, ".bg/add"))).map(
            async (name) => [name, await readFile(join(root, ".bg/add", name), "utf8")] as const,
          ),
        ),
      );
    const before = await read();

    await stagePendingIntentions(root, [other(), pending()], new Set());

    expect(await read()).toEqual(before);
  });

  test("a later add numbers its intentions after the ones already staged, and the session lists them all", async () => {
    const root = await project();
    await stagePendingIntentions(root, [pending()], new Set());

    const staged = await stagePendingIntentions(root, [other()], new Set());

    expect(staged?.files).toEqual([
      { id: other().id, file: `.bg/add/02-${other().id.split("/").at(-1)}.md` },
    ]);
    const session = await readFile(join(root, ".bg/add/session.md"), "utf8");
    expect(session).toContain(ID);
    expect(session).toContain(other().id);
  });

  test("the session leaves out an intention that bg.json records as resolved", async () => {
    const root = await project();
    await stagePendingIntentions(root, [pending(), other()], new Set());

    await stagePendingIntentions(root, [other()], new Set([ID]));

    const session = await readFile(join(root, ".bg/add/session.md"), "utf8");
    expect(session).not.toContain(`— \`${ID}\``);
    expect(session).toContain(other().id);
  });

  test("with nothing pending it writes nothing and says so", async () => {
    const root = await project();

    expect(await stagePendingIntentions(root, [], new Set())).toBeNull();
    expect(await readdir(root)).toEqual([]);
  });

  test("leaves what it did not write alone: a blocked.md, a file the project put there", async () => {
    const root = await project();
    await stagePendingIntentions(root, [pending()], new Set());
    await writeFile(join(root, ".bg/add/blocked.md"), "stuck\n");

    await stagePendingIntentions(root, [other()], new Set());

    expect(await readFile(join(root, ".bg/add/blocked.md"), "utf8")).toBe("stuck\n");
  });
});
