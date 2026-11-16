import { describe, expect, test } from "bun:test";
import { mapLimit } from "./pool";

const tick = () => new Promise<void>((done) => setTimeout(done, 1));

describe("mapLimit", () => {
  test("returns results in input order", async () => {
    const out = await mapLimit([30, 1, 10], 3, async (ms) => {
      await new Promise<void>((done) => setTimeout(done, ms));
      return ms * 2;
    });
    expect(out).toEqual([60, 2, 20]);
  });

  test("never has more than `limit` calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick();
        inFlight -= 1;
      },
    );
    expect(peak).toBe(4);
  });

  test("rejects with the first failure and starts nothing after it", async () => {
    const started: number[] = [];
    await expect(
      mapLimit(
        Array.from({ length: 10 }, (_, i) => i),
        2,
        async (n) => {
          started.push(n);
          await tick();
          if (n === 1) {
            throw new Error("boom 1");
          }
        },
      ),
    ).rejects.toThrow("boom 1");
    expect(started.length).toBeLessThan(10);
  });

  test("handles an empty list", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
});
