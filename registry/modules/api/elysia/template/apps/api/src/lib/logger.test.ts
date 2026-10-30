import { describe, it, expect, spyOn, beforeEach } from "bun:test";
import { createLogger } from "./logger";

describe("logger", () => {
  const logger = createLogger();

  let lastOutput = "";

  beforeEach(() => {
    lastOutput = "";
  });

  function captureConsole(method: "debug" | "info" | "warn" | "error") {
    const spy = spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lastOutput = args[0] as string;
    });
    return spy;
  }

  it("emits valid JSON on info", () => {
    const spy = captureConsole("info");
    logger.info("hello", { scope: "test" });
    spy.mockRestore();

    const entry = JSON.parse(lastOutput) as Record<string, unknown>;
    expect(entry.level).toBe("info");
    expect(entry.msg).toBe("hello");
    expect(entry.scope).toBe("test");
    expect(typeof entry.time).toBe("string");
    expect(() => new Date(entry.time as string)).not.toThrow();
  });

  it("emits valid JSON for each level via the matching console method", () => {
    for (const level of ["debug", "info", "warn"] as const) {
      const spy = captureConsole(level);
      logger[level](`${level} message`);
      spy.mockRestore();

      const entry = JSON.parse(lastOutput) as Record<string, unknown>;
      expect(entry.level).toBe(level);
    }
  });

  it("serializes Error on logger.error", () => {
    const spy = captureConsole("error");
    logger.error("something broke", new Error("boom"), { scope: "auth" });
    spy.mockRestore();

    const entry = JSON.parse(lastOutput) as Record<string, unknown>;
    expect(entry.level).toBe("error");
    expect(entry.msg).toBe("something broke");
    expect(entry.scope).toBe("auth");
    const err = entry.error as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(err.message).toBe("boom");
    expect(typeof err.stack).toBe("string");
  });

  it("handles non-Error values on logger.error without crashing", () => {
    const spy = captureConsole("error");
    logger.error("bad value", "oops");
    spy.mockRestore();

    const entry = JSON.parse(lastOutput) as Record<string, unknown>;
    const err = entry.error as Record<string, unknown>;
    expect(err.raw).toBe("oops");
  });

  it("omits error key when no error is passed", () => {
    const spy = captureConsole("error");
    logger.error("msg only");
    spy.mockRestore();

    const entry = JSON.parse(lastOutput) as Record<string, unknown>;
    expect("error" in entry).toBe(false);
  });
});
