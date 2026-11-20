import { afterAll, describe, expect, it } from "vite-plus/test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { mediaModule, resolveRuntimeStorage } from "./media.module";

const dataDir = await mkdtemp(join(tmpdir(), "storage-fs-module-"));

afterAll(() => rm(dataDir, { recursive: true, force: true }));

/**
 * Runs `body` with some variables of the process set (or unset, for `undefined`), then puts them back.
 * Under Bun `readRuntimeEnv()` is the process environment.
 */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
  set(vars);
  try {
    return await body();
  } finally {
    set(before);
  }
}

// What `apps/api` mounts, over the runtime this test runs in: the one of the provider, on a temp DATA_DIR.
describe("resolveRuntimeStorage", () => {
  it("serves its files under APP_URL, and reads and writes them under <DATA_DIR>/media", async () => {
    const context = await withEnv(
      { DATA_DIR: dataDir, APP_URL: "https://app.acme.com" },
      async () => {
        const resolved = await resolveRuntimeStorage();
        await resolved.bucket.put("medias/a.png", new Uint8Array([1, 2]));
        return resolved;
      },
    );

    expect(context.publicUrl).toBe("https://app.acme.com/v1/media/file");
    expect(await readdir(join(dataDir, "media", "medias"))).toEqual(["a.png"]);
  });

  it("opens the database at <DATA_DIR>/db.sqlite: the same one the db module serves", async () => {
    await withEnv({ DATA_DIR: dataDir }, async () => {
      const { db } = await resolveRuntimeStorage();

      // The tables come from the project's migrations, which this package does not run: the read
      // reaches the file, and fails on the missing table, not on a missing binding.
      await expect(db.query.medias.findFirst()).rejects.toThrow(/medias/);
    });
    expect(await readdir(dataDir)).toContain("db.sqlite");
  });
});

describe("mediaModule, as the API mounts it", () => {
  const app = new Elysia().use(mediaModule);

  it("answers 400 to an unsafe key before it reads anything", async () => {
    const response = await withEnv({ DATA_DIR: dataDir }, () =>
      app.handle(new Request("http://api.test/v1/media/file/medias/..%2Fsecret")),
    );

    expect(response.status).toBe(400);
  });

  it("answers 401 to an upload with no session, and writes nothing", async () => {
    const body = new FormData();
    body.set(
      "file",
      new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "a.jpg", { type: "image/jpeg" }),
    );

    const response = await withEnv({ DATA_DIR: dataDir }, () =>
      app.handle(new Request("http://api.test/v1/media", { method: "POST", body })),
    );

    expect(response.status).toBe(401);
    expect(await readdir(join(dataDir, "media", "medias"))).toEqual(["a.png"]);
  });
});
