import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { CLAIMS_FILE, lazyClaimStore, openClaimStore } from "./claims.node";

const dirs: string[] = [];
async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-claims-"));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("the claim store of the dockerfile provider", () => {
  it("writes <DATA_DIR>/scheduler.sqlite and never creates db.sqlite", async () => {
    const dataDir = join(await tempDataDir(), "nested", "data");

    const store = await openClaimStore(dataDir);
    await store.claim({
      name: "report",
      slot: "2026-11-26T09:00:00.000Z",
      now: new Date("2026-11-26T09:00:00.000Z"),
      leaseMs: 60_000,
    });
    store.close();

    expect(CLAIMS_FILE).toBe("scheduler.sqlite");
    const files = await readdir(dataDir);
    expect(files).toContain("scheduler.sqlite");
    expect(files).not.toContain("db.sqlite");
  });

  it("opens the file under the DATA_DIR it reads from the environment, on the first call", async () => {
    const dataDir = await tempDataDir();
    const claims = lazyClaimStore({ DATA_DIR: dataDir });

    const won = await claims.claim({
      name: "report",
      slot: "2026-11-26T09:00:00.000Z",
      now: new Date("2026-11-26T09:00:00.000Z"),
      leaseMs: 60_000,
    });

    expect(won).toBe(true);
    expect(await readdir(dataDir)).toContain("scheduler.sqlite");
  });
});
