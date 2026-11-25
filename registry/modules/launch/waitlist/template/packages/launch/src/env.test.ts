import { describe, expect, it } from "vite-plus/test";
import { resolveLaunchEnv } from "./env";

describe("resolveLaunchEnv", () => {
  it("reads the stage, and defaults the join limit to 5 an hour", () => {
    expect(resolveLaunchEnv({ LAUNCH_STAGE: "waiting" })).toEqual({
      LAUNCH_STAGE: "waiting",
      LAUNCH_WAITLIST_MAX_PER_HOUR: 5,
    });
    expect(resolveLaunchEnv({ LAUNCH_STAGE: "launched" }).LAUNCH_STAGE).toBe("launched");
  });

  it("reads the join limit as a whole number, and a blank one as unset", () => {
    expect(
      resolveLaunchEnv({ LAUNCH_STAGE: "waiting", LAUNCH_WAITLIST_MAX_PER_HOUR: "12" })
        .LAUNCH_WAITLIST_MAX_PER_HOUR,
    ).toBe(12);
    expect(
      resolveLaunchEnv({ LAUNCH_STAGE: "waiting", LAUNCH_WAITLIST_MAX_PER_HOUR: "" })
        .LAUNCH_WAITLIST_MAX_PER_HOUR,
    ).toBe(5);
  });

  it("rejects a missing or unknown stage: a gate that misreads its setting must not fall open", () => {
    expect(() => resolveLaunchEnv({})).toThrow(/LAUNCH_STAGE/);
    expect(() => resolveLaunchEnv({ LAUNCH_STAGE: "" })).toThrow(/LAUNCH_STAGE/);
    expect(() => resolveLaunchEnv({ LAUNCH_STAGE: "open" })).toThrow(/LAUNCH_STAGE/);
    expect(() => resolveLaunchEnv({ LAUNCH_STAGE: "Launched" })).toThrow(/LAUNCH_STAGE/);
  });

  it("rejects a join limit that is not a positive whole number", () => {
    for (const value of ["0", "-1", "2.5", "many"]) {
      expect(() =>
        resolveLaunchEnv({ LAUNCH_STAGE: "waiting", LAUNCH_WAITLIST_MAX_PER_HOUR: value }),
      ).toThrow(/LAUNCH_WAITLIST_MAX_PER_HOUR/);
    }
  });
});
