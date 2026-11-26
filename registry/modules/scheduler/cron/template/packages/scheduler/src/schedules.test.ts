import { afterEach, describe, expect, it } from "vite-plus/test";
import { clearSchedules, defineSchedule, DEFAULT_TIMEOUT_MS, listSchedules } from "./schedules";

afterEach(clearSchedules);

describe("defineSchedule", () => {
  it("registers a schedule with the default timeout of 15 minutes", () => {
    defineSchedule("nightly", "0 3 * * *", () => {});

    expect(listSchedules().map(({ name, timeoutMs }) => ({ name, timeoutMs }))).toEqual([
      { name: "nightly", timeoutMs: DEFAULT_TIMEOUT_MS },
    ]);
    expect(DEFAULT_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });

  it("keeps the timeout it is given", () => {
    defineSchedule("slow", "*/10 * * * *", () => {}, { timeoutMs: 60_000 });

    expect(listSchedules()[0]?.timeoutMs).toBe(60_000);
  });

  it("throws on a cron that is not exactly 5 fields", () => {
    expect(() => defineSchedule("six", "0 * * * * *", () => {})).toThrow(/exactly 5 fields/);
    expect(() => defineSchedule("four", "* * * *", () => {})).toThrow(/exactly 5 fields/);
    expect(listSchedules()).toEqual([]);
  });

  it("throws on a cron croner refuses", () => {
    expect(() => defineSchedule("bad", "99 * * * *", () => {})).toThrow();
    expect(listSchedules()).toEqual([]);
  });

  it("throws on a duplicate name", () => {
    defineSchedule("once", "* * * * *", () => {});

    expect(() => defineSchedule("once", "0 * * * *", () => {})).toThrow(/already defined/);
  });
});
