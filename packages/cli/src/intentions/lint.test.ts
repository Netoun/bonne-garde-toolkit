import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntentionsLintError, lintIntentions } from "./lint";

async function writeIntention(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body, "utf8");
}

describe("lintIntentions", () => {
  test("accepts an empty migrations tree (template only)", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-int-"));
    try {
      await mkdir(join(root, "migrations"));
      await writeFile(join(root, "migrations", "TEMPLATE.md"), "---\nid: x\n---\n", "utf8");
      const result = await lintIntentions(join(root, "migrations"));
      expect(result.releases).toEqual([]);
      expect(result.errors).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("accepts a valid ordered release", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-int-"));
    try {
      const release = join(root, "migrations", "v0.2.0");
      await mkdir(release, { recursive: true });
      await writeFile(
        join(release, "README.md"),
        "# v0.2.0\n\n- v0.2.0/align-bun-pin\n- v0.2.0/align-ui-utils\n",
        "utf8",
      );
      await writeIntention(
        release,
        "00-align-bun-pin.md",
        `---
id: v0.2.0/align-bun-pin
domain: tooling
classification: migration
---

# Align bun pin
`,
      );
      await writeIntention(
        release,
        "01-align-ui-utils.md",
        `---
id: v0.2.0/align-ui-utils
domain: ui
classification: migration
requires:
  - v0.2.0/align-bun-pin
---

# Align ui utils
`,
      );
      const result = await lintIntentions(join(root, "migrations"));
      expect(result.errors).toEqual([]);
      expect(result.releases).toEqual([
        {
          version: "0.2.0",
          intentions: ["v0.2.0/align-bun-pin", "v0.2.0/align-ui-utils"],
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects requires that appear later in order", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-int-"));
    try {
      const release = join(root, "migrations", "v0.2.0");
      await mkdir(release, { recursive: true });
      await writeFile(join(release, "README.md"), "# v0.2.0\n", "utf8");
      await writeIntention(
        release,
        "00-second.md",
        `---
id: v0.2.0/second
domain: tooling
classification: migration
requires:
  - v0.2.0/first
---

# Second
`,
      );
      await writeIntention(
        release,
        "01-first.md",
        `---
id: v0.2.0/first
domain: tooling
classification: migration
---

# First
`,
      );
      await expect(lintIntentions(join(root, "migrations"))).rejects.toThrow(IntentionsLintError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects id that does not match filename slug / version dir", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-int-"));
    try {
      const release = join(root, "migrations", "v0.2.0");
      await mkdir(release, { recursive: true });
      await writeFile(join(release, "README.md"), "# v0.2.0\n", "utf8");
      await writeIntention(
        release,
        "00-align-bun-pin.md",
        `---
id: v0.1.0/wrong-slug
domain: tooling
classification: migration
---

# Bad
`,
      );
      await expect(lintIntentions(join(root, "migrations"))).rejects.toThrow(/id/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
