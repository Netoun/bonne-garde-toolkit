// The Drizzle schema of the project: every table a module owns, re-exported here, and the tables
// you write yourself. A module adds `export { <tables> } from "<package>/schema";` with the
// `ts.addNamedExport` patch (spec 060) and keeps its tables in its own package, so removing the
// module removes its tables from this file and from the next `bun run db:generate`.
export {};
