/**
 * The schedules of the app. `defineSchedule` is the only way to run code on a timer that this package
 * exports, and the same call works on every provider: a cron has exactly five fields, since the
 * smallest tick a provider offers is one minute.
 */
import { Cron } from "croner";

/** What a handler is given: the schedule's name and the minute it was due. */
export type ScheduleContext = { name: string; scheduledAt: Date };

export type ScheduleOptions = {
  /** How long a run may hold its schedule before the next slot is allowed to start; 15 minutes by default. */
  timeoutMs?: number;
};

export type Schedule = {
  name: string;
  cron: Cron;
  handler: (context: ScheduleContext) => void | Promise<void>;
  timeoutMs: number;
};

export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;

const schedules = new Map<string, Schedule>();

/**
 * Registers a schedule. Throws on a name already defined, and on a cron that is not exactly five
 * fields (minute, hour, day of month, month, day of week) or that croner does not accept.
 */
export function defineSchedule(
  name: string,
  cron: string,
  handler: Schedule["handler"],
  options: ScheduleOptions = {},
): void {
  if (name === "") throw new Error("A schedule needs a name");
  if (schedules.has(name)) throw new Error(`The schedule "${name}" is already defined`);
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `The cron of "${name}" must have exactly 5 fields (minute granularity), got ${fields.length}: "${cron}"`,
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`The timeoutMs of "${name}" must be a positive number`);
  }
  // Paused: croner only parses and matches here, the driver owns the timer. UTC on every provider.
  schedules.set(name, {
    name,
    cron: new Cron(fields.join(" "), { timezone: "UTC", paused: true }),
    handler,
    timeoutMs,
  });
}

/** The schedules defined so far, in definition order. */
export function listSchedules(): Schedule[] {
  return [...schedules.values()];
}

/** Forgets every schedule. For tests: it is not exported from the package. */
export function clearSchedules(): void {
  for (const schedule of schedules.values()) schedule.cron.stop();
  schedules.clear();
}
