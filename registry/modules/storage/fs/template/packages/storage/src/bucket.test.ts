import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { MEDIA_DIR, createFsBucket, readBucket } from "./bucket";
import { R2Error } from "./storage";

const workdir = await mkdtemp(join(tmpdir(), "storage-fs-bucket-"));
const root = join(workdir, "data", MEDIA_DIR);
const outside = join(workdir, "outside");
const bucket = createFsBucket(root);
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

afterAll(() => rm(workdir, { recursive: true, force: true }));

beforeEach(async () => {
  await rm(join(workdir, "data"), { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
  await mkdir(outside, { recursive: true });
});

/** The names found anywhere under `workdir`, which is what a write that left its directory would add to. */
async function everything(): Promise<string[]> {
  return (await readdir(workdir, { recursive: true })).sort();
}

/** What the call rejects with, `undefined` when it resolves. A call, not a promise: one nobody awaits yet is left to reject on its own. */
async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("createFsBucket", () => {
  it("writes the bytes at <root>/<key>, creating the directories, and reads the same bytes back", async () => {
    await bucket.put("medias/uploads/a-b.png", bytes);

    expect(new Uint8Array(await readFile(join(root, "medias/uploads/a-b.png")))).toEqual(bytes);
    expect(await bucket.get("medias/uploads/a-b.png")).toEqual(bytes);
  });

  it("returns null for a key with no file, for a folder, and when the root does not exist yet", async () => {
    expect(await bucket.get("medias/none.png")).toBeNull();
    await bucket.put("medias/uploads/a.png", bytes);
    expect(await bucket.get("medias/uploads")).toBeNull();
    expect(await bucket.get("medias/uploads/a.png/deeper")).toBeNull();
    await rm(root, { recursive: true });
    expect(await bucket.get("medias/uploads/a.png")).toBeNull();
  });

  it("deletes the file, and a missing one is not an error", async () => {
    await bucket.put("medias/a.png", bytes);

    await bucket.delete("medias/a.png");
    await bucket.delete("medias/a.png");

    expect(await bucket.get("medias/a.png")).toBeNull();
    await rm(root, { recursive: true });
    await expect(bucket.delete("medias/a.png")).resolves.toBeUndefined();
  });

  it("does not overwrite a file that is there, and keeps it", async () => {
    await bucket.put("medias/a.png", bytes);

    await expect(bucket.put("medias/a.png", new Uint8Array([9]))).rejects.toThrow();

    expect(await bucket.get("medias/a.png")).toEqual(bytes);
  });

  it("deletes a file, not a folder", async () => {
    await bucket.put("medias/a/b.png", bytes);

    await expect(bucket.delete("medias/a")).rejects.toThrow();

    expect(await bucket.get("medias/a/b.png")).toEqual(bytes);
  });

  for (const [label, key] of [
    ["a `..` segment", "medias/../../outside/x.png"],
    ["a leading `..`", "../outside/x.png"],
    ["an absolute key", `${outside}/x.png`],
    ["an empty segment", "medias//x.png"],
    ["a control character", "medias/a\nb.png"],
    ["a NUL", "medias/a\0b.png"],
    ["a backslash", "medias\\..\\x.png"],
    ["an empty key", ""],
  ] as const) {
    it(`rejects ${label} on every call, and nothing is written outside the media directory`, async () => {
      await bucket.put("medias/seed.png", bytes);
      const before = await everything();

      for (const action of [
        () => bucket.put(key, bytes),
        () => bucket.get(key),
        () => bucket.delete(key),
      ]) {
        const error = await rejection(action);
        expect(error).toBeInstanceOf(R2Error);
        expect(error).toMatchObject({ code: "INVALID_KEY" });
      }

      expect(await everything()).toEqual(before);
    });
  }

  it("rejects a key that goes through a symbolic link, to read, write or delete outside the directory", async () => {
    await writeFile(join(outside, "secret.png"), "secret");
    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, "link"));
    const before = await everything();

    for (const action of [
      () => bucket.get("link/secret.png"),
      () => bucket.put("link/new.png", bytes),
      () => bucket.put("link/new/deeper.png", bytes),
      () => bucket.delete("link/secret.png"),
    ]) {
      expect(await rejection(action)).toMatchObject({ code: "INVALID_KEY" });
    }

    expect(await everything()).toEqual(before);
    expect(await readFile(join(outside, "secret.png"), "utf8")).toBe("secret");
  });

  it("does not follow a link that stands where the file would be written", async () => {
    await mkdir(join(root, "medias"), { recursive: true });
    await symlink(join(outside, "target.png"), join(root, "medias/a.png"));

    expect(await rejection(() => bucket.put("medias/a.png", bytes))).toBeInstanceOf(R2Error);

    expect(await readdir(outside)).toEqual([]);
  });

  it("works when the media directory is itself a link, as a mounted volume can be", async () => {
    await mkdir(join(workdir, "data"), { recursive: true });
    await symlink(outside, root);

    await bucket.put("medias/a.png", bytes);

    expect(await bucket.get("medias/a.png")).toEqual(bytes);
    expect(await readdir(join(outside, "medias"))).toEqual(["a.png"]);
  });
});

describe("readBucket", () => {
  it("is <DATA_DIR>/media of the environment it is given", async () => {
    const dataDir = join(workdir, "data-from-env");

    await (await readBucket({ DATA_DIR: dataDir, NODE_ENV: "test" })).put("medias/a.png", bytes);

    expect(await readdir(join(dataDir, MEDIA_DIR, "medias"))).toEqual(["a.png"]);
  });
});
