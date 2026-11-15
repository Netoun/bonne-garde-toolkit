import { describe, expect, test } from "bun:test";
import {
  adaptedPaths,
  parseFrontmatter,
  readModuleIntention,
  referencePaths,
  sectionBody,
} from "./intention-document";

const document = (frontmatter: string, body = "# Wire the mailer\n\n## Goal\n\nx\n") =>
  `---\n${frontmatter}\n---\n\n${body}`;

const VALID = document(
  [
    "id: email/resend/wire-email-into-auth",
    "kind: install",
    "domain: email",
    "classification: migration",
  ].join("\n"),
);

describe("parseFrontmatter", () => {
  test("reads scalars, inline lists and block lists", () => {
    expect(
      parseFrontmatter(
        document(
          [
            "id: a/b/c",
            'domain: "email"',
            "requires:",
            "  - a/b/one",
            "  - a/b/two",
            "tags: [x, y]",
          ].join("\n"),
        ),
      ),
    ).toEqual({
      id: "a/b/c",
      domain: "email",
      requires: ["a/b/one", "a/b/two"],
      tags: ["x", "y"],
    });
  });

  test("refuses a file that does not start with frontmatter, or never closes it", () => {
    expect(() => parseFrontmatter("# no frontmatter\n")).toThrow(/missing frontmatter/);
    expect(() => parseFrontmatter("---\nid: a\n")).toThrow(/unclosed frontmatter/);
  });
});

describe("readModuleIntention: the intention a module authors under intent/ (065)", () => {
  test("is read by its file name and frontmatter: id, order, slug, the heading as the title", () => {
    expect(readModuleIntention("email/resend", "01-wire-email-into-auth.md", VALID)).toEqual({
      id: "email/resend/wire-email-into-auth",
      order: 1,
      slug: "wire-email-into-auth",
      domain: "email",
      classification: "migration",
      requires: [],
      title: "Wire the mailer",
    });
  });

  test("carries requires, in the order written", () => {
    const meta = readModuleIntention(
      "email/resend",
      "02-two.md",
      document(
        [
          "id: email/resend/two",
          "kind: install",
          "domain: email",
          "classification: informational",
          "requires:",
          "  - email/resend/one",
        ].join("\n"),
      ),
    );

    expect(meta.requires).toEqual(["email/resend/one"]);
  });

  test.each([
    ["a file name without the NN- order prefix", "wire.md", VALID, /must be named NN-slug\.md/],
    [
      "an id that is not <category>/<module-id>/<slug> of the module and the file",
      "01-other.md",
      VALID,
      /id must be email\/resend\/other, got email\/resend\/wire-email-into-auth/,
    ],
    [
      "a kind other than install",
      "01-wire-email-into-auth.md",
      VALID.replace("kind: install", "kind: migration"),
      /kind must be install/,
    ],
    [
      "a domain that is not the module's category",
      "01-wire-email-into-auth.md",
      VALID.replace("domain: email", "domain: auth"),
      /domain must be email/,
    ],
    [
      "a classification this format does not know",
      "01-wire-email-into-auth.md",
      VALID.replace("classification: migration", "classification: nice-to-have"),
      /classification must be one of informational, migration, breaking-manual/,
    ],
    [
      "no frontmatter",
      "01-wire-email-into-auth.md",
      "# Wire\n",
      /01-wire-email-into-auth\.md: missing frontmatter/,
    ],
  ])("refuses %s", (_what, fileName, source, message) => {
    expect(() => readModuleIntention("email/resend", fileName, source)).toThrow(message);
  });
});

const WITH_PATHS = document(
  "id: email/resend/wire-email-into-auth\nkind: install\ndomain: email\nclassification: migration",
  [
    "# Wire",
    "",
    "## Out of Scope",
    "",
    "- `adapt` `not/a/reference.ts` — another section's bullet",
    "",
    "## Reference Paths",
    "",
    "- `adapt` `packages/auth/src/mailer.ts` — read it first; keep the rest.",
    "* `packages/email/src/index.ts` — `copy`",
    "- `adapt` `packages/auth/src/auth.module.ts`",
    "",
    "## Validation",
    "",
    "- `bun run check`",
  ].join("\n"),
);

describe("sectionBody", () => {
  test("is the lines after the heading, up to the next one, and null when there is none", () => {
    expect(sectionBody(WITH_PATHS, "Validation")).toBe("\n- `bun run check`");
    expect(sectionBody(WITH_PATHS, "Goal")).toBeNull();
  });
});

describe("referencePaths (065 Sections: each path declares copy or adapt)", () => {
  test("reads the mode and the path of every bullet of Reference Paths, whichever comes first", () => {
    expect(referencePaths(WITH_PATHS)).toEqual([
      { mode: "adapt", path: "packages/auth/src/mailer.ts" },
      { mode: "copy", path: "packages/email/src/index.ts" },
      { mode: "adapt", path: "packages/auth/src/auth.module.ts" },
    ]);
  });

  test("a bullet with a mode and no path, or a path and no mode, says so with a null", () => {
    expect(
      referencePaths(
        document("id: a/b/c", "## Reference Paths\n\n- `adapt` the mailer\n- `src/x.ts` — read it"),
      ),
    ).toEqual([
      { mode: "adapt", path: null },
      { mode: null, path: "src/x.ts" },
    ]);
  });

  test("a document with no Reference Paths section has none", () => {
    expect(referencePaths(VALID)).toEqual([]);
  });
});

describe("adaptedPaths: what `bg record` marks as edited by the intention (060)", () => {
  test("is the paths declared adapt, and not the ones declared copy", () => {
    expect(adaptedPaths(WITH_PATHS)).toEqual([
      "packages/auth/src/mailer.ts",
      "packages/auth/src/auth.module.ts",
    ]);
  });

  test("leaves out a path that is not one file of the project: a glob, a parent, an absolute path", () => {
    const source = document(
      "id: a/b/c",
      [
        "## Reference Paths",
        "",
        "- `adapt` `packages/auth/src/*.ts`",
        "- `adapt` `../outside.ts`",
        "- `adapt` `/etc/hosts`",
        "- `adapt` `packages/auth/src/mailer.ts`",
      ].join("\n"),
    );

    expect(adaptedPaths(source)).toEqual(["packages/auth/src/mailer.ts"]);
  });

  test("lists a file once, however many bullets name it", () => {
    const source = document(
      "id: a/b/c",
      "## Reference Paths\n\n- `adapt` `src/x.ts`\n- `adapt` `src/x.ts` — again",
    );

    expect(adaptedPaths(source)).toEqual(["src/x.ts"]);
  });
});
