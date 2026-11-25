import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { openStateStore, STATE_FILE } from "./state.node";

const dirs: string[] = [];
async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "realtime-state-"));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("the state store of the dockerfile provider", () => {
  it("sets, gets, lists, deletes and clears, each room seeing only its own keys", async () => {
    const store = await openStateStore(await tempDataDir());

    await store.set("r1", "count", "1");
    await store.set("r1", "name", '"a"');
    await store.set("r2", "count", "2");

    expect(await store.get("r1", "count")).toBe("1");
    expect(await store.get("r2", "count")).toBe("2");
    expect(await store.get("r1", "missing")).toBeUndefined();
    expect(await store.list("r1")).toEqual({ count: "1", name: '"a"' });
    expect(await store.list("r2")).toEqual({ count: "2" });

    await store.set("r1", "count", "3");
    expect(await store.get("r1", "count")).toBe("3");

    await store.delete("r1", "count");
    expect(await store.list("r1")).toEqual({ name: '"a"' });

    await store.clear("r1");
    expect(await store.list("r1")).toEqual({});
    expect(await store.list("r2")).toEqual({ count: "2" });
    store.close();
  });

  it("creates the directory, keeps the state in <DATA_DIR>/realtime.sqlite, and reads it back once reopened", async () => {
    const dataDir = join(await tempDataDir(), "nested", "data");

    const first = await openStateStore(dataDir);
    await first.set("r1", "count", "7");
    first.close();
    const second = await openStateStore(dataDir);

    expect(STATE_FILE).toBe("realtime.sqlite");
    expect((await stat(join(dataDir, "realtime.sqlite"))).isFile()).toBe(true);
    expect(await second.get("r1", "count")).toBe("7");
    second.close();
  });
});
