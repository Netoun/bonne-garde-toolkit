import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { writeAllOrNothing } from "./write-tree";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bg-writetree-"));
  dirs.push(dir);
  return dir;
}

/** Every path under `root` with its content (`<dir>` for a directory), so two trees compare whole. */
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

describe("writeAllOrNothing", () => {
  test("creates missing directories and replaces existing files", async () => {
    const root = await freshDir();
    await writeFile(join(root, "old.txt"), "old");

    await writeAllOrNothing([
      { path: join(root, "a/b/new.txt"), content: "new" },
      { path: join(root, "old.txt"), content: "replaced" },
    ]);

    expect(await snapshot(root)).toEqual({
      "a/": "<dir>",
      "a/b/": "<dir>",
      "a/b/new.txt": "new",
      "old.txt": "replaced",
    });
  });

  test("keeps the mode of a file it replaces", async () => {
    const root = await freshDir();
    await writeFile(join(root, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });

    await writeAllOrNothing([{ path: join(root, "run.sh"), content: "#!/bin/sh\necho hi\n" }]);

    expect((await stat(join(root, "run.sh"))).mode & 0o777).toBe(0o755);
  });

  test("an error midway restores every earlier write: no new file, no new directory, no temp file", async () => {
    const root = await freshDir();
    await writeFile(join(root, "keep.txt"), "original");
    // The last target is a directory, so the write that reaches it fails after the others succeeded.
    await mkdir(join(root, "blocked"));
    await writeFile(join(root, "blocked/inside.txt"), "inside");
    const before = await snapshot(root);

    await expect(
      writeAllOrNothing([
        { path: join(root, "deep/er/created.txt"), content: "created" },
        { path: join(root, "keep.txt"), content: "overwritten" },
        { path: join(root, "second.txt"), content: "second" },
        { path: join(root, "blocked"), content: "not a file" },
      ]),
    ).rejects.toThrow();

    expect(await snapshot(root)).toEqual(before);
  });

  test("a file blocking a parent directory fails the same way, and leaves nothing", async () => {
    const root = await freshDir();
    await writeFile(join(root, "blocker"), "i am a file");
    const before = await snapshot(root);

    await expect(
      writeAllOrNothing([
        { path: join(root, "ok/one.txt"), content: "1" },
        { path: join(root, "blocker/two.txt"), content: "2" },
      ]),
    ).rejects.toThrow();

    expect(await snapshot(root)).toEqual(before);
  });

  test("writes nothing for an empty list", async () => {
    const root = await freshDir();
    await writeAllOrNothing([]);
    expect(await snapshot(root)).toEqual({});
  });
});
