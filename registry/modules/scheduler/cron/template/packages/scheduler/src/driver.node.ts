/**
 * The scheduler on Node: one croner job, every minute, that calls `runDue`. Selected by the package's
 * `./driver` export; `apps/api/src/index.ts` imports it so the job starts with the API. The claims live
 * in `scheduler.sqlite` (`claims.node.ts`) and make a slot run once and a schedule never overlap.
 * The dockerfile provider runs one instance.
 */
import { Cron } from "croner";
// The extension stays: the container runs this file on Node, which does not resolve `./claims.node` to `claims.node.ts`.
import { lazyClaimStore } from "./claims.node.ts";
import { runDue } from "./dispatch";

const claims = lazyClaimStore();

const job = new Cron("* * * * *", { timezone: "UTC" }, (self) => {
  // The minute croner meant, not the clock's: a timer that fires a hair early would otherwise name the previous slot.
  void runDue(self.currentRun() ?? new Date(), claims);
});

/** Stops the tick: no new slot starts. A run already going finishes or is cut with the process. */
export const stopScheduler: () => void = () => {
  job.stop();
};
