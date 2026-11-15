import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { IntentionsLintError } from "./lint";
import { lintModuleIntentions } from "./lint-modules";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const SECTIONS = [
  "Goal",
  "Why",
  "Applies When",
  "Do Not Apply When",
  "Observable Gaps",
  "Out of Scope",
  "Reference Paths",
  "Validation",
  "Record Result",
];

/** A well-formed intention of `email/resend`; each test breaks one thing in it. */
function document(
  slug: string,
  options: { requires?: string[]; sections?: string[]; references?: string } = {},
): string {
  const requires = options.requires?.length
    ? `requires:\n${options.requires.map((id) => `  - ${id}`).join("\n")}\n`
    : "";
  const body = (options.sections ?? SECTIONS)
    .map((name) =>
      name === "Reference Paths"
        ? `## ${name}\n\n${options.references ?? "- `adapt` `packages/auth/src/mailer.ts` — read it first"}\n`
        : `## ${name}\n\nx\n`,
    )
    .join("\n");
  return `---\nid: email/resend/${slug}\nkind: install\ndomain: email\nclassification: migration\n${requires}---\n\n# Title\n\n${body}`;
}

type Spec = {
  /** `intent` of the variants, by variant key. */
  variants?: Record<string, string[]>;
  /** Files under `intent/`. */
  files: Record<string, string>;
};

async function registry(spec: Spec): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bg-lint-mod-"));
  dirs.push(root);
  const dir = join(root, "modules/email/resend");
  await mkdir(join(dir, "intent"), { recursive: true });
  await writeFile(
    join(dir, "module.json"),
    JSON.stringify({
      id: "resend",
      category: "email",
      title: "Resend",
      description: "Resend",
      variants: Object.entries(spec.variants ?? { default: Object.keys(spec.files) }).map(
        ([key, intent]) => ({ key, match: {}, ...(intent.length > 0 ? { intent } : {}) }),
      ),
    }),
  );
  for (const [name, text] of Object.entries(spec.files)) {
    await mkdir(dirname(join(dir, "intent", name)), { recursive: true });
    await writeFile(join(dir, "intent", name), text);
  }
  return root;
}

async function errorsOf(root: string): Promise<string[]> {
  try {
    await lintModuleIntentions(root);
  } catch (error) {
    if (error instanceof IntentionsLintError) {
      return error.errors;
    }
    throw error;
  }
  return [];
}

describe("lintModuleIntentions (065: one linter for modules and migrations)", () => {
  test("accepts a module whose intentions are well-formed, and lists them by module", async () => {
    const root = await registry({
      files: {
        "01-wire.md": document("wire"),
        "02-then.md": document("then", { requires: ["email/resend/wire"] }),
      },
    });

    expect(await lintModuleIntentions(root)).toEqual([
      { module: "email/resend", intentions: ["email/resend/wire", "email/resend/then"] },
    ]);
  });

  test("a registry with no module that ships an intention is clean", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-lint-mod-"));
    dirs.push(root);
    await mkdir(join(root, "modules/email/resend"), { recursive: true });
    await writeFile(join(root, "modules/email/resend/module.json"), "{}");

    expect(await lintModuleIntentions(root)).toEqual([]);
  });

  test("names the file when its id is not the module's or the file's own", async () => {
    const root = await registry({ files: { "01-wire.md": document("other") } });

    expect(await errorsOf(root)).toEqual([
      "email/resend: 01-wire.md: id must be email/resend/wire, got email/resend/other",
    ]);
  });

  test("refuses two files with one order prefix", async () => {
    const root = await registry({
      files: { "01-wire.md": document("wire"), "01-then.md": document("then") },
    });

    expect(await errorsOf(root)).toContain("email/resend: duplicate order prefix 01");
  });

  test("requires an id that is defined, and earlier in the order", async () => {
    const root = await registry({
      files: {
        "01-wire.md": document("wire", { requires: ["email/resend/then", "email/resend/nope"] }),
        "02-then.md": document("then"),
      },
    });

    expect(await errorsOf(root)).toEqual([
      "email/resend: 01-wire.md requires email/resend/then, which does not appear earlier in execution order",
      "email/resend: 01-wire.md requires email/resend/nope, which no intention of the module defines",
    ]);
  });

  test("requires every section of the format, naming the ones missing", async () => {
    const root = await registry({
      files: {
        "01-wire.md": document("wire", {
          sections: SECTIONS.filter((name) => name !== "Validation" && name !== "Out of Scope"),
        }),
      },
    });

    expect(await errorsOf(root)).toEqual([
      "email/resend: 01-wire.md is missing the sections: Out of Scope, Validation",
    ]);
  });

  test("every Reference Path declares copy or adapt, and there is at least one", async () => {
    const root = await registry({
      files: {
        "01-wire.md": document("wire", {
          references: "- `adapt` `a.ts` — fine\n- `packages/auth/src/mailer.ts` — says nothing",
        }),
        "02-then.md": document("then", { references: "no list at all" }),
      },
    });

    expect(await errorsOf(root)).toEqual([
      "email/resend: 01-wire.md: Reference Paths line `- `packages/auth/src/mailer.ts` — says nothing` declares neither copy nor adapt",
      "email/resend: 02-then.md: Reference Paths lists no path",
    ]);
  });

  test("an adapt path names one file of the project, since `bg record` makes it a region key: no glob, no parent, and one is there", async () => {
    const root = await registry({
      files: {
        "01-wire.md": document("wire", {
          references: [
            "- `adapt` `packages/auth/src/*.ts`",
            "- `adapt` `../outside.ts`",
            "- `adapt` the mailer, with no path",
            "- `adapt` `packages/auth/src/mailer.ts` — fine",
            "- `copy` `packages/email/src/*.ts` — a copy may name what it takes",
          ].join("\n"),
        }),
      },
    });

    expect(await errorsOf(root)).toEqual([
      "email/resend: 01-wire.md: Reference Paths line `- `adapt` `packages/auth/src/*.ts`` declares adapt on `packages/auth/src/*.ts`, which is not one file of the project (a repo-relative path with no glob)",
      "email/resend: 01-wire.md: Reference Paths line `- `adapt` `../outside.ts`` declares adapt on `../outside.ts`, which is not one file of the project (a repo-relative path with no glob)",
      "email/resend: 01-wire.md: Reference Paths line `- `adapt` the mailer, with no path` declares adapt and names no path in backticks",
    ]);
  });

  test("a file no variant names is orphaned, and a name no file answers to is dangling", async () => {
    const root = await registry({
      variants: { default: ["02-gone.md"] },
      files: { "01-wire.md": document("wire") },
    });

    expect(await errorsOf(root)).toEqual([
      "email/resend: variant default names 02-gone.md, which intent/ does not hold",
      "email/resend: intent/01-wire.md is named by no variant",
    ]);
  });

  test("reports every module's errors together, not the first", async () => {
    const root = await registry({ files: { "01-wire.md": document("other") } });
    const second = join(root, "modules/auth/better-auth");
    await mkdir(join(second, "intent"), { recursive: true });
    await writeFile(
      join(second, "module.json"),
      JSON.stringify({
        id: "better-auth",
        category: "auth",
        title: "x",
        description: "x",
        variants: [{ key: "default", match: {}, intent: ["01-x.md"] }],
      }),
    );
    await writeFile(join(second, "intent/01-x.md"), "no frontmatter\n");

    expect(await errorsOf(root)).toEqual([
      "auth/better-auth: 01-x.md: missing frontmatter",
      "email/resend: 01-wire.md: id must be email/resend/wire, got email/resend/other",
    ]);
  });
});
