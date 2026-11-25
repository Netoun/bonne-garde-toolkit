/** Where the project stands: `waiting` keeps the launch-guarded routes shut, `launched` opens them. */
export type LaunchStage = "waiting" | "launched";

/** What launch reads from the runtime's environment. */
export type LaunchEnv = { LAUNCH_STAGE: LaunchStage; LAUNCH_WAITLIST_MAX_PER_HOUR: number };

const DEFAULT_MAX_PER_HOUR = 5;

/**
 * The launch environment out of a plain record, as `readRuntimeEnv()` returns it. Pure: it reads no
 * runtime global. Throws when `LAUNCH_STAGE` is missing or is anything but `waiting` or `launched`: a
 * gate that misreads its setting must not fall open. `LAUNCH_WAITLIST_MAX_PER_HOUR` is optional (5), a
 * blank one counts as unset, and anything but a positive whole number is refused.
 */
export function resolveLaunchEnv(source: Record<string, unknown>): LaunchEnv {
  const stage = source.LAUNCH_STAGE;
  if (stage !== "waiting" && stage !== "launched") {
    throw new Error('Invalid environment variable: LAUNCH_STAGE must be "waiting" or "launched".');
  }
  const raw = source.LAUNCH_WAITLIST_MAX_PER_HOUR;
  if (raw === undefined || raw === "") {
    return { LAUNCH_STAGE: stage, LAUNCH_WAITLIST_MAX_PER_HOUR: DEFAULT_MAX_PER_HOUR };
  }
  const max = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : 0;
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new Error(
      "Invalid environment variable: LAUNCH_WAITLIST_MAX_PER_HOUR must be a positive whole number.",
    );
  }
  return { LAUNCH_STAGE: stage, LAUNCH_WAITLIST_MAX_PER_HOUR: max };
}
