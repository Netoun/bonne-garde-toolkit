import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { isUnbound, readPostgres } from "./postgres";
import { startTestPostgres } from "./postgres-testing";

let server: Awaited<ReturnType<typeof startTestPostgres>>;
let other: Awaited<ReturnType<typeof startTestPostgres>>;

beforeAll(async () => {
  server = await startTestPostgres();
  other = await startTestPostgres();
});

afterAll(async () => {
  const sql = [
    await readPostgres({ DATABASE_URL: server.url }),
    await readPostgres({ DATABASE_URL: other.url }),
  ];
  await Promise.all(sql.map((client) => client.end({ timeout: 1 })));
  await Promise.all([server.stop(), other.stop()]);
});

describe("readPostgres", () => {
  it("answers a query on the server DATABASE_URL names", async () => {
    const sql = await readPostgres({ DATABASE_URL: server.url, NODE_ENV: "test" });

    const rows = await sql`select 1 as one`;

    expect(rows[0]?.one).toBe(1);
    expect(isUnbound(sql)).toBe(false);
  });

  it("returns the same client on every call, even two at once", async () => {
    const source = { DATABASE_URL: server.url, NODE_ENV: "test" };

    const [first, second] = await Promise.all([readPostgres(source), readPostgres(source)]);
    const third = await readPostgres(source);

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("returns another client for another URL", async () => {
    const first = await readPostgres({ DATABASE_URL: server.url, NODE_ENV: "test" });
    const second = await readPostgres({ DATABASE_URL: other.url, NODE_ENV: "test" });

    expect(second).not.toBe(first);
  });

  it.each([
    ["blank", { DATABASE_URL: "", NODE_ENV: "test" }],
    ["unset", { NODE_ENV: "test" }],
  ])(
    "resolves an unbound client when DATABASE_URL is %s, whose query names the variable",
    async (_, source) => {
      const sql = await readPostgres(source);

      expect(isUnbound(sql)).toBe(true);
      const failure: unknown = await sql`select 1`.then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(Error);
      const text = [failure, failure instanceof Error ? failure.cause : undefined]
        .map((error) => (error instanceof Error ? error.message : ""))
        .join(" ");
      expect(text).toContain("DATABASE_URL");
      expect(text).toContain("vp run db:up");
    },
  );
});
