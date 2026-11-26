/**
 * What a tick does, whatever the provider: take the minute, find the schedules due in it, claim each
 * one, run it, record how it ended. The claim store is the only part that differs per provider.
 */
import { listSchedules } from "./schedules";

export type Claim = {
  name: string;
  /** The ISO minute the run is for. */
  slot: string;
  /** The tick's time: the lease is counted from it. */
  now: Date;
  leaseMs: number;
};

export type Outcome = { status: "done" } | { status: "failed"; error: string };

/**
 * Where runs are claimed. `claim` is won by at most one caller per `(name, slot)`, and not at all
 * while a run of the same schedule holds a lease that has not passed.
 */
export type ClaimStore = {
  claim(claim: Claim): Promise<boolean>;
  finish(claim: Claim, outcome: Outcome): Promise<void>;
};

export type RunResult = { name: string; slot: string; result: "done" | "failed" | "skipped" };

/** The ISO minute of a date: `2026-11-26T09:05:00.000Z`. */
export function slotOf(date: Date): string {
  return new Date(Math.floor(date.getTime() / 60_000) * 60_000).toISOString();
}

/** A store that fails is reported, not thrown: the tick goes on with the other schedules. */
function warn(message: string, error: unknown): void {
  // oxlint-disable-next-line no-console
  console.error(`[scheduler] ${message}`, error);
}

/**
 * Runs the schedules due in the minute of `scheduledAt`. A handler that throws is recorded as failed;
 * a store that fails skips that schedule. Never throws.
 */
export async function runDue(scheduledAt: Date, claims: ClaimStore): Promise<RunResult[]> {
  const slot = slotOf(scheduledAt);
  const minute = new Date(slot);
  const due = listSchedules().filter((schedule) => schedule.cron.match(minute));
  return Promise.all(
    due.map(async (schedule): Promise<RunResult> => {
      const claim: Claim = {
        name: schedule.name,
        slot,
        now: scheduledAt,
        leaseMs: schedule.timeoutMs,
      };
      try {
        if (!(await claims.claim(claim))) return { name: schedule.name, slot, result: "skipped" };
      } catch (error) {
        warn(`could not claim "${schedule.name}" for ${slot}`, error);
        return { name: schedule.name, slot, result: "skipped" };
      }
      let outcome: Outcome = { status: "done" };
      try {
        await schedule.handler({ name: schedule.name, scheduledAt: minute });
      } catch (error) {
        outcome = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      try {
        await claims.finish(claim, outcome);
      } catch (error) {
        warn(`could not record "${schedule.name}" for ${slot}`, error);
      }
      return { name: schedule.name, slot, result: outcome.status };
    }),
  );
}
