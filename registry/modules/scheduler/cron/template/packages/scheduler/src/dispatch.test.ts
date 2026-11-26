import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vite-plus/test";
import { openClaimStore } from "./claims.node";
import { runDue, slotOf, type ClaimStore } from "./dispatch";
import { clearSchedules, defineSchedule } from "./schedules";

const dirs: string[] = [];
const stores: { close(): void }[] = [];
async function tempDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "scheduler-"));
  dirs.push(dir);
  return dir;
}
async function open(dataDir: string): Promise<ClaimStore> {
  const store = await openClaimStore(dataDir);
  stores.push(store);
  return store;
}

afterEach(clearSchedules);
afterAll(async () => {
  for (const store of stores) store.close();
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const at = (iso: string): Date => new Date(iso);

describe("runDue", () => {
  it("runs a handler once when two ticks of the same minute arrive at the same time", async () => {
    const dataDir = await tempDataDir();
    const first = await open(dataDir);
    const second = await open(dataDir);
    let calls = 0;
    defineSchedule("report", "* * * * *", async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    const [a, b] = await Promise.all([
      runDue(at("2026-11-26T09:05:00.000Z"), first),
      runDue(at("2026-11-26T09:05:00.000Z"), second),
    ]);

    expect(calls).toBe(1);
    expect([...a, ...b].map((run) => run.result).sort()).toEqual(["done", "skipped"]);
  });

  it("hands the handler its name and the minute, seconds dropped", async () => {
    const claims = await open(await tempDataDir());
    const seen: { name: string; scheduledAt: Date }[] = [];
    defineSchedule("report", "5 9 * * *", (context) => {
      seen.push(context);
    });

    await runDue(at("2026-11-26T09:05:37.512Z"), claims);

    expect(seen).toEqual([{ name: "report", scheduledAt: at("2026-11-26T09:05:00.000Z") }]);
    expect(slotOf(at("2026-11-26T09:05:37.512Z"))).toBe("2026-11-26T09:05:00.000Z");
  });

  it("does not run a handler on a minute its cron does not match", async () => {
    const claims = await open(await tempDataDir());
    let calls = 0;
    defineSchedule("report", "5 9 * * *", () => {
      calls += 1;
    });

    const results = await runDue(at("2026-11-26T09:06:00.000Z"), claims);

    expect(calls).toBe(0);
    expect(results).toEqual([]);
  });

  it("runs a slot once even when it is ticked again later", async () => {
    const claims = await open(await tempDataDir());
    let calls = 0;
    defineSchedule("report", "* * * * *", () => {
      calls += 1;
    });

    await runDue(at("2026-11-26T09:05:00.000Z"), claims);
    const again = await runDue(at("2026-11-26T09:05:30.000Z"), claims);

    expect(calls).toBe(1);
    expect(again.map((run) => run.result)).toEqual(["skipped"]);
  });

  it("skips the next slot while a run holds a lease in the future, and runs it once the lease has passed", async () => {
    const claims = await open(await tempDataDir());
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    defineSchedule(
      "report",
      "* * * * *",
      async () => {
        calls += 1;
        // Only the first run hangs: it is the one holding the lease.
        if (calls === 1) await gate;
      },
      { timeoutMs: 5 * 60_000 },
    );

    const running = runDue(at("2026-11-26T09:00:00.000Z"), claims);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const during = await runDue(at("2026-11-26T09:01:00.000Z"), claims);
    const lastMinuteOfLease = await runDue(at("2026-11-26T09:04:00.000Z"), claims);
    const afterLease = await runDue(at("2026-11-26T09:05:00.000Z"), claims);
    release();
    await running;

    expect(during.map((run) => run.result)).toEqual(["skipped"]);
    expect(lastMinuteOfLease.map((run) => run.result)).toEqual(["skipped"]);
    expect(afterLease.map((run) => run.result)).toEqual(["done"]);
    expect(calls).toBe(2);
  });

  it("records a throwing handler as failed with its message, and runs the next slot", async () => {
    const dataDir = await tempDataDir();
    const claims = await open(dataDir);
    let calls = 0;
    defineSchedule("report", "* * * * *", () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
    });

    const first = await runDue(at("2026-11-26T09:00:00.000Z"), claims);
    const next = await runDue(at("2026-11-26T09:01:00.000Z"), claims);

    expect(first).toEqual([{ name: "report", slot: "2026-11-26T09:00:00.000Z", result: "failed" }]);
    expect(next.map((run) => run.result)).toEqual(["done"]);
    const { createClient } = await import("@libsql/client");
    const client = createClient({ url: `file:${join(dataDir, "scheduler.sqlite")}` });
    const { rows } = await client.execute(
      "select slot, status, error from schedule_runs order by slot",
    );
    client.close();
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { slot: "2026-11-26T09:00:00.000Z", status: "failed", error: "boom" },
      { slot: "2026-11-26T09:01:00.000Z", status: "done", error: null },
    ]);
  });

  it("does not throw when the claim store fails", async () => {
    defineSchedule("report", "* * * * *", () => {});
    const broken: ClaimStore = {
      claim: () => Promise.reject(new Error("disk full")),
      finish: () => Promise.reject(new Error("disk full")),
    };

    const results = await runDue(at("2026-11-26T09:00:00.000Z"), broken);

    expect(results.map((run) => run.result)).toEqual(["skipped"]);
  });
});
