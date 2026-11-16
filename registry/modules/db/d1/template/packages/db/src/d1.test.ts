import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Miniflare } from "miniflare";
import { D1_BINDING, bindD1, readD1 } from "./d1";

// A real D1, which is what Miniflare runs workerd's for: no stand-in, no mock.
const miniflare = new Miniflare({
  modules: true,
  script: "export default {}",
  d1Databases: { [D1_BINDING]: "d1-test" },
});
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;

beforeAll(async () => {
  d1 = await miniflare.getD1Database(D1_BINDING);
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("bindD1", () => {
  it("returns the binding the environment holds, and it answers queries", async () => {
    const database = bindD1({ [D1_BINDING]: d1 });

    await database.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
    await database.prepare("INSERT INTO notes (body) VALUES (?)").bind("first").run();
    const rows = await database.prepare("SELECT body FROM notes").all<{ body: string }>();

    expect(database).toBe(d1);
    expect(rows.results).toEqual([{ body: "first" }]);
  });

  it("returns a database that names the binding when the environment has none", () => {
    expect(() => bindD1({}).prepare("SELECT 1")).toThrow(`"${D1_BINDING}"`);
  });

  it("does not take an environment variable of the same name for the binding", () => {
    expect(() => bindD1({ [D1_BINDING]: "a string" }).prepare("SELECT 1")).toThrow(
      `"${D1_BINDING}"`,
    );
  });

  it("fails on every entry point of the database, not only the first", async () => {
    const database = bindD1({});

    expect(() => database.prepare("SELECT 1")).toThrow();
    expect(() => database.batch([])).toThrow();
    expect(() => database.exec("SELECT 1")).toThrow();
    expect(() => database.withSession()).toThrow();
    expect(() => database.dump()).toThrow();
  });
});

describe("readD1", () => {
  it("is the database that fails where the runtime provides no binding, as under bun test", () => {
    return readD1().then((database) => {
      expect(() => database.prepare("SELECT 1")).toThrow(`"${D1_BINDING}"`);
    });
  });
});
