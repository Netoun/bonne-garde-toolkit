import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { DATABASE_FILE, readLibsql } from "./libsql";

const dirs: string[] = [];
async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "libsql-"));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("readLibsql", () => {
  it("opens <DATA_DIR>/db.sqlite, and creates the directory when it is missing", async () => {
    const dataDir = join(await tempDataDir(), "nested", "data");

    const client = await readLibsql({ DATA_DIR: dataDir, NODE_ENV: "test" });
    await client.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY)");

    expect(DATABASE_FILE).toBe("db.sqlite");
    expect((await stat(join(dataDir, "db.sqlite"))).isFile()).toBe(true);
  });

  it("returns the same client on every call, even two at once, and answers a query", async () => {
    const source = { DATA_DIR: await tempDataDir(), NODE_ENV: "test" };

    const [first, second] = await Promise.all([readLibsql(source), readLibsql(source)]);
    const third = await readLibsql(source);

    expect(second).toBe(first);
    expect(third).toBe(first);
    const result = await first.execute("select 1 as one");
    expect(result.rows[0]?.one).toBe(1);
  });

  it("opens another file for another DATA_DIR", async () => {
    const first = await readLibsql({ DATA_DIR: await tempDataDir(), NODE_ENV: "test" });
    const second = await readLibsql({ DATA_DIR: await tempDataDir(), NODE_ENV: "test" });

    expect(second).not.toBe(first);
  });
});
