# audit/log

An append-only audit log: who did what, when, with the row before and after. It installs
`packages/audit` (`{{SCOPE}}/audit`) and its table, `audit_log`. This first release has no route: the
table, the atomic write and the triggers. The request actor and `GET /audit` come next.

```bash
bunx bonne-garde add audit/log
```

Peers: `api` (`elysia`), `db` (`d1` or `libsql`), `orm` (`drizzle`) and `auth` (`better-auth`). There is
no Postgres variant: auth does not support it yet. One variant serves D1 and libsql, because Drizzle's
`db.batch` is atomic on both.

## The table

`audit_log`: `id`, `organizationId` (nullable), `actorId` (nullable, **no foreign key**: the log
outlives a deleted user), `action`, `entityType`, `entityId` (nullable), `before` and `after` (JSON
text, nullable), `createdAt`. An index on (`organizationId`, `createdAt`). The module re-exports it
from `packages/db/src/schema/index.ts`, so `vp run db:generate` creates it.

## Write with an entry

```ts
import { writeWithAudit } from "{{SCOPE}}/audit";

await writeWithAudit(db, [db.update(posts).set({ title }).where(eq(posts.id, id))], {
  organizationId,
  actorId: session.user.id,
  action: "post.rename",
  entityType: "post",
  entityId: id,
  before: { title: previous },
  after: { title },
});
```

`writes` is a non-empty array of Drizzle queries, not awaited. They and the audit insert go in one
`db.batch`: if any statement fails, nothing is written. `before` and `after` are stored as JSON.
Never write the audited row on its own and the entry after: that is the window this removes.

## Append-only

Two SQLite triggers, `BEFORE UPDATE` and `BEFORE DELETE` on `audit_log`, abort with
`audit_log is append-only`. `drizzle-kit generate` does not emit triggers, so no migration carries
them: `ensureAuditTriggers(db)` applies them (`CREATE TRIGGER IF NOT EXISTS`) once per process and
database, and `writeWithAudit` calls it before every write. The same SQL runs on D1 and libsql.

A database whose table was filled by another path, with no `writeWithAudit` call yet, has no triggers
until `ensureAuditTriggers` runs once.

## Tests

`createTestAuditDb(tables?)` from `{{SCOPE}}/audit/testing` is the project's test database (the fake
D1 or libsql, whichever `db` is installed) with `audit_log`, the tables a test brings and the triggers.
