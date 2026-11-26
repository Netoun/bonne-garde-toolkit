# scheduler/cron

Cron schedules that run once per tick. `defineSchedule(name, cron, handler)` registers one; every minute
the scheduler finds the schedules due, **claims** each in the database, runs it, and records how it ended.

```bash
bunx bonne-garde add provider/dockerfile api/elysia scheduler/cron
```

The cloudflare variant is not there yet: `peers.provider` is `dockerfile` only.

| Provider     | Driver                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------- |
| `dockerfile` | [croner](https://github.com/Hexagon/croner) in the process, claims in `scheduler.sqlite` |

## Peers

| Peer       | Allow-list   | Why                                                                  |
| ---------- | ------------ | -------------------------------------------------------------------- |
| `provider` | `dockerfile` | The claims live in a file under `DATA_DIR`, the container's volume   |
| `api`      | `elysia`     | `apps/api/src/index.ts` loads the driver, so the tick starts with it |

There is no `db` peer: the claims have a libsql file of their own, `<DATA_DIR>/scheduler.sqlite` (`.data` by
default), never `db.sqlite`, so a project on `db/postgres` runs too.

## What it writes

Everything in `packages/scheduler`, plus the driver in `apps/api/src/index.ts`
(`export { stopScheduler } from "<scope>/scheduler/driver"`).

| File                 | What it is                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/index.ts`       | The package's only export: `defineSchedule`                                                             |
| `src/schedules.ts`   | The registry behind it, and the checks on a name and a cron                                             |
| `src/dispatch.ts`    | `runDue(scheduledAt, claims)` and the `ClaimStore` interface, the same on every provider                |
| `src/claims.node.ts` | `dockerfile`: the claim store, the table `schedule_runs`                                                |
| `src/driver.node.ts` | `dockerfile`: the `./driver` export, one croner job on `* * * * *` that calls `runDue`; `stopScheduler` |

## Use

```ts
import { defineSchedule } from "{{SCOPE}}/scheduler";

defineSchedule("purge-expired-invitations", "0 3 * * *", async ({ name, scheduledAt }) => {
  await purgeExpired(scheduledAt);
});
// A run may hold the schedule for 15 minutes by default; say otherwise per schedule.
defineSchedule("sync", "*/5 * * * *", sync, { timeoutMs: 60_000 });
```

Define schedules at module load, from a file the API imports. `defineSchedule` throws on a name already
defined and on a cron that is not exactly five fields (minute, hour, day of month, month, day of week):
the finest tick is one minute on every provider, so a six-field cron with seconds is refused. Times are UTC.

The package exports no other way to run code on a timer, and does not re-export croner: a test pins the export
list, so a schedule that is not in `defineSchedule` does not exist.

## Once per slot, no overlap

A slot is the ISO minute (`2026-11-26T09:05:00.000Z`). Claiming is one SQL statement: it inserts a
`running` row for `(name, slot)` unless that slot exists already, or a `running` row of the same schedule has
a `lease_until` still in the future. It is won if and only if a row went in, so the database says who runs, and
the two rules (once per slot, no overlap) come from the same statement. The lease is `timeoutMs` from the tick;
when the handler ends the row becomes `done`, or `failed` with the error's message.

- `timeoutMs` is the lease, not a kill: a handler that outlives it is **not** stopped, the next slot is just
  allowed to start beside it.
- A handler that throws is recorded and the next slot runs. `runDue` never throws.
- On SIGTERM the container exits at once. A run cut short keeps its lease; the next slot runs once it expires.
  **Handlers must be idempotent**: a slot can be cut and retried by the next one, and may run twice.
- `schedule_runs` keeps one row per run and is never pruned.

The dockerfile provider runs one instance. Two would share nothing but a volume, and SQLite on a shared volume
is not a lock to rely on.
