import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { Elysia } from "elysia";
import { Miniflare } from "miniflare";
import { dbModule, dbPlugin } from "./module";

const miniflare = new Miniflare({
  modules: true,
  script: "export default {}",
  d1Databases: { DB: "module-test" },
});
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;

beforeAll(async () => {
  d1 = await miniflare.getD1Database("DB");
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("dbPlugin", () => {
  it("puts a Drizzle client on the context of the routes after it", async () => {
    const app = new Elysia()
      .use(dbPlugin(async () => d1))
      .get("/one", ({ db }) => db.all<{ one: number }>(sql`SELECT 1 AS one`));

    const response = await app.handle(new Request("http://localhost/one"));

    const body: unknown = await response.json();
    expect(response.status).toBe(200);
    expect(body).toEqual([{ one: 1 }]);
  });
});

describe("dbModule", () => {
  // No binding under `bun test`: the app still loads and answers, and the route that queries says why not.
  const app = new Elysia()
    .use(dbModule)
    .get("/ping", () => "pong")
    .get("/query", ({ db }) => db.all(sql`SELECT 1`));

  it("lets a route that does not query answer without a binding", async () => {
    const response = await app.handle(new Request("http://localhost/ping"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("pong");
  });

  it("fails the route that queries, naming the binding", async () => {
    const response = await app.handle(new Request("http://localhost/query"));

    expect(response.status).toBe(500);
    expect(await response.text()).toContain('"DB"');
  });
});
