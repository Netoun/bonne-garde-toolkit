#!/usr/bin/env bun
/**
 * The golden project: what a consumer does, end to end, in a fresh directory, once per configuration.
 *
 *   bg create → bg add of a UI item, refused → bg add of the configuration's modules and every item in
 *   one call → the same bg add again, which must skip every patch and change nothing, and each module
 *   again on its own, which must too → bun install
 *   → typecheck → test → build → bg doctor --strict
 *   → for a configuration with a database: a table added to the schema barrel, `bun run db:generate`,
 *     the migration applied to a local D1 (`wrangler`, no network, no account), and what D1 holds read back,
 *     the tables of its modules (`medias`, storage's) in the migration and in D1 as well
 *   → for a configuration with storage: the tests of `@scope/storage` counted, since the media routes
 *     run only in the project (they import packages a project installs)
 *   → for a configuration with auth: `bun run auth:generate` again, which has to write the schema the
 *     module ships byte for byte (it is generator output, not a hand-edited file); `db:seed`, then a row
 *     in every other table (a media with an author and no organization among them), `db:reset`, which has
 *     to empty every table of the barrel, `db:seed` again, and once more on the seeded database, which has
 *     to say so, exit 0 and change no row
 *   → bun run check → the `checks` of every installed module
 *   → for the configuration that ships a Dockerfile, docker build, docker run, and the container's answers
 *
 * A configuration is a set of modules that fit in one project. `provider` admits one module and the
 * `api` module ships a variant per provider, so each provider is a configuration of its own: the
 * `cloudflare` one installs every item too, the `dockerfile` one only modules, and no SSR or static site.
 * Packing and the refusal run once.
 *
 * The image phases need a docker daemon. With no `docker` on PATH, or none that answers `docker info`,
 * golden says so, in the timing table too, and still exits 0: every other failure of them fails the run.
 * CI sets `GOLDEN_REQUIRE_DOCKER=1`, under which an unavailable docker fails the run instead.
 * What they create is named `bg-golden-<pid>` (image, container, volume) and removed by that name.
 *
 * Any non-zero exit fails the run and names the phase. It needs a real `bun install` against npm,
 * so it is not part of `verify`; CI runs it as its own step.
 *
 * The CLI under test is the packed one (`bun run pack:cli`), driven as a subprocess so argv
 * parsing is exercised. It runs from a copy outside the repo: the packed `paths.ts` still walks up
 * to find the repo root, and `templateBaseDir()` falls back to the repo's `templates/base`, so in
 * place under `dist/` a pack that dropped its `templates/` would still pass. From a copy under the
 * temp directory, `bg create` can only use what the pack carries.
 *
 * Usage:
 *   bun run golden
 *   bun scripts/golden-project.ts
 */

import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PACKED_CLI = join(ROOT, "dist/npm/create-bonne-garde");
const BUN = "bun";

/**
 * The project's npm scope. Registry files are authored for `@acme` and `add` rewrites the scope at
 * copy time, which moves line lengths and so where the formatter wraps. A scope of `@acme`'s length
 * could not show it, and the one `create` derives from the directory name (`@golden-app`) happened
 * to wrap like it. `@app` is shorter: it un-wraps what `@acme` had to wrap.
 */
export const SCOPE = "@app";

/**
 * Items `bg list` shows that stay out of the golden project, each with its reason. An entry for an
 * item the registry no longer lists fails the run, so this list cannot go stale. Empty on purpose
 * but for the item a module replaces, until the item is removed: every other item is installed.
 */
export const EXCLUDED: Readonly<Record<string, string>> = {
  portless: "the item dev/portless replaces; `bg add` refuses a bare name that is also a module",
};

export type Excluded = { name: string; reason: string };

/** The item names to `bg add`, read from `bg list` output (`name<TAB>type<TAB>description`). */
export function selectItems(
  listing: string,
  exclusions: Readonly<Record<string, string>>,
): { items: string[]; excluded: Excluded[] } {
  const listed = listing
    .split("\n")
    .map((line) => (line.split("\t")[0] ?? "").trim())
    .filter((name) => name.length > 0);

  const stale = Object.keys(exclusions).filter((name) => !listed.includes(name));
  if (stale.length > 0) {
    throw new Error(`excluded but not listed by the registry: ${stale.join(", ")}`);
  }

  const items = listed.filter((name) => !Object.hasOwn(exclusions, name));
  if (items.length === 0) {
    throw new Error("bg list left no items to install");
  }

  return {
    items,
    excluded: listed
      .filter((name) => Object.hasOwn(exclusions, name))
      .map((name) => ({ name, reason: exclusions[name] ?? "" })),
  };
}

/** One project golden builds: the modules `bg add` installs in one call, and whether every item comes with them. */
export type Configuration = {
  name: string;
  /** `<category>/<id>`, in the order they are given to `bg add`. */
  modules: readonly string[];
  /** Also install every item `bg list --items` shows. Items land in `packages/ui` and need the `ui` module. */
  items: boolean;
};

/**
 * The projects golden builds. A module that is in none of them, and not in `EXCLUDED_MODULES`, fails
 * the run, so a new module is a decision made here and not a silent gap. `provider` admits one module,
 * and a variant of `api` is selected on it, which is why each provider has a configuration.
 */
export const CONFIGURATIONS: readonly Configuration[] = [
  {
    name: "cloudflare",
    modules: [
      "provider/cloudflare",
      "tooling/vite-plus",
      "config/branding",
      "ui/shadcn",
      "api/elysia",
      "db/d1",
      "orm/drizzle",
      "auth/better-auth",
      "storage/r2",
      "web/spa",
      "web/ssr",
      "web/static",
      "dev/portless",
      "email/resend",
    ],
    items: true,
  },
  {
    name: "dockerfile",
    modules: [
      "provider/dockerfile",
      "tooling/vite-plus",
      "config/branding",
      "ui/shadcn",
      "api/elysia",
      "web/spa",
      "dev/portless",
      "email/resend",
    ],
    items: false,
  },
];

/** The module that ships the `Dockerfile` golden builds. */
const IMAGE_MODULE = "provider/dockerfile";

/** Whether the configuration ships a Dockerfile, so golden builds its image and asks the container. */
export function buildsImage(configuration: Configuration): boolean {
  return configuration.modules.includes(IMAGE_MODULE);
}

/** The module that turns a schema into migrations, so that there is a database to generate and migrate. */
const ORM_MODULE = "orm/drizzle";

/** Whether the configuration has an `orm`, so golden adds a table, generates its migration and applies it to a local D1. */
export function hasDatabase(configuration: Configuration): boolean {
  return configuration.modules.includes(ORM_MODULE);
}

/** The module whose schema is what `auth:generate` writes, and the file that holds it. */
const AUTH_MODULE = "auth/better-auth";
export const AUTH_SCHEMA_FILE = "packages/auth/src/schema.ts";

/** Whether the configuration has auth, so golden generates its schema again and compares. */
export function hasAuth(configuration: Configuration): boolean {
  return configuration.modules.includes(AUTH_MODULE);
}

/** The module whose tests golden has to see run, and whose table has to be in the migration. */
const STORAGE_MODULE = "storage/r2";

/** Whether the configuration has storage, so golden counts its tests and expects its table in the migration. */
export function hasStorage(configuration: Configuration): boolean {
  return configuration.modules.includes(STORAGE_MODULE);
}

/**
 * The schema `auth:generate` writes has to be the one the module ships. The legacy file kept a hand
 * edit the generator would drop on its next run, so this is what says the module has none.
 */
export function expectRegenerated(shipped: string, regenerated: string): void {
  if (regenerated === shipped) {
    return;
  }
  const was = shipped.split("\n");
  const now = regenerated.split("\n");
  const line = was.findIndex((text, index) => text !== now[index]);
  const at = line === -1 ? Math.min(was.length, now.length) : line;
  throw new Error(
    `\`bun run auth:generate\` wrote a ${AUTH_SCHEMA_FILE} that differs from the shipped one, from line ${at + 1}: ` +
      `shipped \`${was[at] ?? "(end of file)"}\`, generated \`${now[at] ?? "(end of file)"}\``,
  );
}

/** The admin `db:seed` creates (`packages/auth/src/seed.ts`), which golden reads back from D1. */
export const SEEDED_ADMIN = "admin@example.local";

/**
 * What `db:seed` left in D1: one user, the admin, verified, who owns one organization. It deletes
 * nothing and leaves a database that has the admin as it is, so after `db:reset` or a second run it is
 * the same rows, not two admins.
 */
export function expectSeeded(
  users: readonly Record<string, unknown>[],
  members: readonly Record<string, unknown>[],
): void {
  const [admin, ...others] = users;
  if (admin === undefined || others.length > 0 || admin.email !== SEEDED_ADMIN) {
    throw new Error(`D1 holds users ${JSON.stringify(users)}, expected only ${SEEDED_ADMIN}`);
  }
  if (admin.email_verified !== 1) {
    throw new Error(`the seeded admin is not verified: ${JSON.stringify(admin)}`);
  }
  const [owner, ...rest] = members;
  if (owner === undefined || rest.length > 0 || owner.role !== "owner") {
    throw new Error(
      `D1 holds members ${JSON.stringify(members)}, expected the admin as the one owner`,
    );
  }
}

/**
 * What a project needs for `auth/better-auth` but its ORM. Adding auth to it is refused, and the
 * message names the missing peer's category (035 and 050 acceptance), before anything is written.
 */
export const WITHOUT_ORM: readonly string[] = [
  "provider/cloudflare",
  "config/branding",
  "api/elysia",
  "db/d1",
];

/** `bg add <name>` failed and named `category` as the peer it needs: what an agent reads to fix it. */
export function expectPeerRefusal(attempt: Attempt, name: string, category: string): void {
  if (attempt.code === 0) {
    throw new Error(
      `\`bg add ${name}\` succeeded in a project with no ${category} module: it must be refused`,
    );
  }
  if (!attempt.stderr.includes(`category ${category}`)) {
    throw new Error(
      `\`bg add ${name}\` was refused without naming the missing peer category ${category}; it printed: ${attempt.stderr.trim() || "(nothing)"}`,
    );
  }
}

/**
 * `orm/drizzle` ships an empty schema barrel: the tables are the modules' (`auth`, `storage`) and the
 * project's. Golden adds one the way the project does, a file of its own and a line in the barrel,
 * since `db:generate` has nothing to write for an empty schema.
 */
export const GOLDEN_TABLE = "golden_notes";
export const GOLDEN_SCHEMA_FILE = "packages/db/src/schema/golden-notes.ts";
export const GOLDEN_BARREL_FILE = "packages/db/src/schema/index.ts";
export const GOLDEN_BARREL_LINE = 'export { goldenNotes } from "./golden-notes";\n';
export const GOLDEN_SCHEMA = `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const goldenNotes = sqliteTable("${GOLDEN_TABLE}", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
});
`;

/**
 * The tables a module adds to the schema barrel, which `db:generate` has to write into the migration
 * and D1 has to hold once it is applied. Auth's are read back by the seed phase, which clears and
 * inserts into them.
 */
export const MODULE_TABLES: Readonly<Record<string, readonly string[]>> = {
  "storage/r2": ["medias"],
};

/** What the migration has to create in a configuration: the table golden adds, and each module's own. */
export function expectedTables(configuration: Configuration): string[] {
  return [GOLDEN_TABLE, ...configuration.modules.flatMap((name) => MODULE_TABLES[name] ?? [])];
}

/** `db:seed` on a database that has the admin: it exits 0 and says it changed nothing. */
export function expectAlreadySeeded(stdout: string): void {
  if (!stdout.includes("Already seeded")) {
    throw new Error(`db:seed on a seeded database did not say it changed nothing:\n${stdout}`);
  }
}

/**
 * The tables the auth schema declares (`packages/auth/src/schema.ts`, which a test compares this with):
 * `db:seed` fills them, and `db:reset` has to empty them with everything else the barrel exports.
 */
export const AUTH_TABLES: readonly string[] = [
  "account",
  "invitation",
  "member",
  "organization",
  "session",
  "user",
  "verification",
];

/**
 * Every table `db:reset` has to leave empty in a configuration: the auth tables, the one golden adds to
 * the barrel, and each module's own. It is the orm's script, so it empties what the barrel exports and
 * not what a module lists, and this is what says the barrel exports each of them.
 */
export function resetTables(configuration: Configuration): string[] {
  return [...(hasAuth(configuration) ? AUTH_TABLES : []), ...expectedTables(configuration)];
}

/**
 * A media with the admin as its author and no organization. `medias.author_id` has no cascade, and
 * `organization_id` does: a media of an organization goes when the organization is deleted, so it never
 * stopped a reset that deleted organizations first. One with none stops the delete of its author, which
 * is what `auth`'s own reset ran into.
 */
export const GOLDEN_MEDIA_STATEMENT = `INSERT INTO medias (id, name, url, key, size, mime_type, author_id) SELECT 'golden-media', 'golden.png', 'http://localhost/golden.png', 'golden/golden.png', 1, 'image/png', id FROM "user" WHERE email = '${SEEDED_ADMIN}' LIMIT 1`;

/** A row in the table golden adds to the barrel, which no module owns: reset empties the project's tables too. */
export const GOLDEN_NOTE_STATEMENT = `INSERT INTO ${GOLDEN_TABLE} (body) VALUES ('golden')`;

/**
 * One query that counts the rows of every table, as one row with a column per table. A compound
 * `SELECT ... UNION ALL` would be shorter, and D1 refuses one of more than five terms.
 */
export function countStatement(tables: readonly string[]): string {
  return `SELECT ${tables.map((table) => `(SELECT count(*) FROM "${table}") AS "${table}"`).join(", ")}`;
}

/** The counts `countStatement` returned, by table. */
export function readCounts(rows: readonly Record<string, unknown>[]): Record<string, number> {
  const [row, ...others] = rows;
  if (row === undefined || others.length > 0) {
    throw new Error(`D1 gave ${rows.length} rows for the counts, expected one row`);
  }
  const counts: Record<string, number> = {};
  for (const [table, held] of Object.entries(row)) {
    if (typeof held !== "number") {
      throw new Error(`D1 gave no count for ${table}: ${JSON.stringify(held)}`);
    }
    counts[table] = held;
  }
  return counts;
}

/** Each table in `expected` holds that many rows: names every one that differs, and one that was not counted. */
export function expectRows(
  counts: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
): void {
  const wrong = Object.entries(expected).flatMap(([table, rows]) => {
    const held = counts[table];
    if (held === undefined) {
      return [`${table} was not counted`];
    }
    return held === rows ? [] : [`${table} holds ${held}, expected ${rows}`];
  });
  if (wrong.length > 0) {
    throw new Error(`D1 holds other rows than expected: ${wrong.join("; ")}`);
  }
}

/** The modules of every configuration, each once, in the order they first appear. */
export const MODULES: readonly string[] = [
  ...new Set(CONFIGURATIONS.flatMap((configuration) => configuration.modules)),
];

/** The item `refuse` tries with no ui module, and the module its refusal has to name. */
const REFUSED_ITEM = "button";
const REFUSED_MODULE = "ui/shadcn";

/**
 * Modules `bg list` shows that stay out of every configuration, each with its reason. An entry for
 * a module the registry no longer lists fails the run, as for `EXCLUDED`. Empty on purpose.
 */
export const EXCLUDED_MODULES: Readonly<Record<string, string>> = {};

/**
 * The module ids to `bg add`, read from the `module` lines of `bg list` output
 * (`<category>/<id><TAB>module<TAB>description`). `installed` is what golden installs, in that order,
 * over all configurations; every other listed module must be in `exclusions`.
 */
export function selectModules(
  listing: string,
  installed: readonly string[],
  exclusions: Readonly<Record<string, string>>,
): { modules: string[]; excluded: Excluded[] } {
  const listed = listing
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([, type]) => type?.trim() === "module")
    .map(([name]) => (name ?? "").trim())
    .filter((name) => name.length > 0);

  const both = installed.filter((name) => Object.hasOwn(exclusions, name));
  if (both.length > 0) {
    throw new Error(`${both.join(", ")} is both installed and excluded`);
  }
  const stale = [...installed, ...Object.keys(exclusions)].filter((name) => !listed.includes(name));
  if (stale.length > 0) {
    throw new Error(`named but not listed by the registry: ${stale.join(", ")}`);
  }
  const undecided = listed.filter(
    (name) => !installed.includes(name) && !Object.hasOwn(exclusions, name),
  );
  if (undecided.length > 0) {
    throw new Error(
      `${undecided.join(", ")} listed by the registry, neither installed nor excluded: install it (MODULES) or exclude it with a reason (EXCLUDED_MODULES)`,
    );
  }
  if (installed.length === 0) {
    throw new Error("no modules to install");
  }

  return {
    modules: [...installed],
    excluded: listed
      .filter((name) => Object.hasOwn(exclusions, name))
      .map((name) => ({ name, reason: exclusions[name] ?? "" })),
  };
}

/**
 * The modules of each configuration whose variants declare a tier-2 patch, with the regions each
 * one's patches write there. Variants patch differently (`api/elysia` writes `dev` and `deploy` for
 * `wrangler` and only `dev` for the container), so this is per configuration. Golden checks that
 * `bg add` reports exactly these as `applied` and, run again, as `skipped`: a module that gains or
 * loses a patch is a decision made here, as a module that is not installed is.
 */
export const PATCHED: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  cloudflare: {
    "config/branding": ["scripts.gen:branding"],
    "api/elysia": ["scripts.deploy", "scripts.dev"],
    "db/d1": [
      "d1_databases",
      "env.production.d1_databases",
      "scripts.db:migrate:local",
      "scripts.db:migrate:remote",
    ],
    "auth/better-auth": [
      "dependencies.@app/auth",
      "dependencies.@app/auth",
      "elysia[app].use[authModule]",
      "exports[@app/auth/schema]",
      "imports[@app/auth]",
    ],
    "storage/r2": [
      "dependencies.@app/storage",
      "dependencies.@app/storage",
      "elysia[app].use[mediaModule]",
      "env.production.r2_buckets",
      "env.production.vars.R2_PUBLIC_URL",
      "exports[@app/storage/schema]",
      "imports[@app/storage]",
      "r2_buckets",
      "vars.R2_PUBLIC_URL",
    ],
    "orm/drizzle": [
      "dependencies.@app/db",
      "dependencies.drizzle-orm",
      "dependencies.elysia",
      "devDependencies.drizzle-kit",
      "elysia[app].use[dbModule]",
      'exports."."',
      'exports."./reset"',
      'exports."./schema"',
      'exports."./testing"',
      "imports[@app/db]",
      "scripts.db:generate",
      "scripts.db:reset",
      "scripts.db:studio",
    ],
    "web/spa": ["scripts.deploy", "scripts.dev"],
    "web/ssr": ["scripts.deploy", "scripts.dev"],
    "web/static": ["scripts.deploy", "scripts.dev"],
    "dev/portless": [
      "devDependencies.portless",
      "scripts.dev:lan:portless",
      "scripts.dev:portless",
    ],
    // Not the import into mailer.ts: that is the intention's edit, and the file it edits is
    // region-checked by the `intent[<id>]` region `bg record` leaves.
    "email/resend": ["dependencies.@app/email"],
  },
  dockerfile: {
    "config/branding": ["scripts.gen:branding"],
    "api/elysia": ["scripts.dev"],
    "web/spa": ["scripts.dev"],
    "dev/portless": [
      "devDependencies.portless",
      "scripts.dev:lan:portless",
      "scripts.dev:portless",
    ],
  },
};

/** One patch of a module, as `bg add` prints it (spec 060): its outcome and, per region, what it did. */
export type AddedPatch = {
  type: string;
  file: string;
  status: string;
  reason?: string;
  regions: { region: string; status: string }[];
};

/** A module `bg add` reported, with the commands it declares to validate itself (spec 050 step 15) and its patches. */
export type AddedModule = { module: string; checks: string[]; patches: AddedPatch[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function readPatch(module: string, patch: unknown): AddedPatch {
  if (
    !isRecord(patch) ||
    typeof patch.type !== "string" ||
    typeof patch.file !== "string" ||
    typeof patch.status !== "string" ||
    !Array.isArray(patch.regions)
  ) {
    throw new Error(`bg add printed a patch of ${module} without type, file, status and regions`);
  }
  const regions = patch.regions.map((region: unknown) => {
    if (
      !isRecord(region) ||
      typeof region.region !== "string" ||
      typeof region.status !== "string"
    ) {
      throw new Error(`bg add printed a region of a patch of ${module} without region and status`);
    }
    return { region: region.region, status: region.status };
  });
  return {
    type: patch.type,
    file: patch.file,
    status: patch.status,
    ...(typeof patch.reason === "string" ? { reason: patch.reason } : {}),
    regions,
  };
}

/**
 * The modules in the JSON `bg add` prints, which is where the packed CLI says what it installed
 * and what each module checks: `add` prints those commands and does not run them. Fails when a
 * module in `expected` is not among them.
 */
export function readAddedModules(stdout: string, expected: readonly string[]): AddedModule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bg add did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.modules)) {
    throw new Error("bg add printed no `modules` array");
  }
  const added = parsed.modules.map((entry: unknown): AddedModule => {
    if (!isRecord(entry) || typeof entry.module !== "string") {
      throw new Error("bg add printed a module with no `module` key");
    }
    const checks = entry.checks ?? [];
    if (!isStringArray(checks)) {
      throw new Error(`bg add printed \`checks\` of ${entry.module} that is not a list of strings`);
    }
    const patches = entry.patches ?? [];
    if (!Array.isArray(patches)) {
      throw new Error(`bg add printed \`patches\` of ${entry.module} that is not a list`);
    }
    const { module } = entry;
    return { module, checks, patches: patches.map((patch) => readPatch(module, patch)) };
  });
  const missing = expected.filter((name) => !added.some(({ module }) => module === name));
  if (missing.length > 0) {
    throw new Error(`bg add did not report ${missing.join(", ")}`);
  }
  return added;
}

/**
 * Spec 060: a failed patch is never silent, and a re-add finds every region present and equal.
 * Checks every patch `bg add` reported against `status`, and the regions of each module against
 * `expected`, which is where golden says which modules patch what.
 */
export function expectPatches(
  added: readonly AddedModule[],
  status: "applied" | "skipped",
  expected: Readonly<Record<string, readonly string[]>>,
): void {
  for (const { module, patches } of added) {
    for (const patch of patches) {
      if (patch.status === "failed") {
        throw new Error(
          `${module}: patch ${patch.type} on ${patch.file} failed: ${patch.reason ?? "no reason given"}`,
        );
      }
      if (patch.status !== status || patch.regions.some((region) => region.status !== status)) {
        throw new Error(
          `${module}: patch ${patch.type} on ${patch.file} was ${patch.status} (regions: ${patch.regions.map((region) => `${region.region} ${region.status}`).join(", ") || "none"}), expected ${status}`,
        );
      }
    }
    if (patches.length > 0 && !Object.hasOwn(expected, module)) {
      throw new Error(`${module} patches files but is not in PATCHED: say what golden should see`);
    }
  }
  for (const [module, regions] of Object.entries(expected)) {
    const reported = added
      .filter((entry) => entry.module === module)
      .flatMap(({ patches }) =>
        patches.flatMap((patch) => patch.regions.map(({ region }) => region)),
      );
    if (JSON.stringify([...reported].sort()) !== JSON.stringify([...regions].sort())) {
      throw new Error(
        `${module} reported regions [${reported.join(", ")}], golden expects [${regions.join(", ")}]`,
      );
    }
  }
}

/**
 * The regions `bg add` reported must be in `bg.json` under `regions`, owned by the module that
 * reported them: the printed outcome and the recorded state are two things, and this ties them.
 */
export function expectRegionsRecorded(manifest: unknown, added: readonly AddedModule[]): void {
  const regions = isRecord(manifest) && isRecord(manifest.regions) ? manifest.regions : null;
  if (regions === null) {
    throw new Error("bg.json has no `regions` object");
  }
  for (const { module, patches } of added) {
    for (const { file, regions: reported } of patches) {
      const owned = regions[file];
      for (const { region } of reported) {
        const owner = isRecord(owned) ? owned[region] : undefined;
        if (owner !== module) {
          throw new Error(
            `bg.json records ${region} of ${file} for ${String(owner)}, and bg add reported it for ${module}`,
          );
        }
      }
    }
  }
}

/**
 * What differs between two snapshots of a project, as `<path> changed|added|removed`. `bg.json` is
 * compared without `installedAt`, the one thing a re-add moves in it. Any other change in it is
 * reported, the recorded status of a patch included.
 */
export function diffTrees(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string[] {
  const settled = (path: string, text: string) =>
    path === "bg.json" ? text.replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"') : text;
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths.flatMap((path) => {
    const was = before[path];
    const now = after[path];
    if (was === undefined) {
      return [`${path} added`];
    }
    if (now === undefined) {
      return [`${path} removed`];
    }
    return settled(path, was) === settled(path, now) ? [] : [`${path} changed`];
  });
}

/** Every file of a project with its text, `node_modules` and `.git` left out. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })) {
    if (!/^(?:node_modules|\.git)\//.test(path)) {
      tree[path] = await Bun.file(join(root, path)).text();
    }
  }
  return tree;
}

/**
 * The argv of the one `bg add` golden runs per configuration: every module, then every item the
 * configuration has. One call, so a module and the items that need it are planned together, and never
 * `--force`: two installs that write the same file have to fail here and not be settled by an
 * overwrite. A name given twice, and no module, fail, so a broken `bg list` is not a green run (an
 * empty item list is `selectItems`'s to refuse: a configuration may have none).
 */
export function addArguments(modules: readonly string[], items: readonly string[]): string[] {
  if (modules.length === 0) {
    throw new Error("no modules to add");
  }
  const names = [...modules, ...items];
  const twice = names.filter((name, index) => names.indexOf(name) !== index);
  if (twice.length > 0) {
    throw new Error(`named twice in one \`bg add\`: ${[...new Set(twice)].join(", ")}`);
  }
  return ["add", ...names, "--yes", "--no-install"];
}

/** The module whose package is `<scope>/email`, whose tests golden counts. */
const EMAIL_MODULE = "email/resend";

/** Whether the configuration installs email, so golden counts its tests and resolves what it wires. */
export function hasEmail(configuration: Configuration): boolean {
  return configuration.modules.includes(EMAIL_MODULE);
}

/** How many tests the email package runs in the project; fewer means the root `test` stopped reaching it. */
export const EMAIL_MIN_TESTS = 19;

/** The file auth documents as the one place an email module wires itself in, and the proof golden adds beside it. */
export const MAILER_FILE = "packages/auth/src/mailer.ts";
const WIRED_TEST_FILE = "packages/auth/src/mailer.wired.test.ts";

/**
 * The intentions `bg add` leaves pending (050 step 14, 065), per configuration: what the variants it
 * selects ship. Golden resolves each the way an executor would, and a configuration that gains one is a
 * decision made here. The dockerfile project has no auth, so email selects the variant that wires nothing
 * and nothing is pending: it installs cleanly and `doctor --strict` is green as it is.
 */
export const PENDING: Readonly<Record<string, readonly string[]>> = {
  cloudflare: ["email/resend/wire-email-into-auth"],
  dockerfile: [],
};

/** The ids in the `pendingIntentions` list `bg add` prints. */
export function readPendingIntentions(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bg add did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.pendingIntentions)) {
    throw new Error("bg add printed no `pendingIntentions` array");
  }
  return parsed.pendingIntentions.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      throw new Error("bg add printed a pending intention without an id");
    }
    return entry.id;
  });
}

/** The pending intentions are the ones golden expects: no more, which would be unresolved work, and no fewer. */
export function expectPending(reported: readonly string[], expected: readonly string[]): void {
  if (JSON.stringify([...reported].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(
      `bg add left pending [${reported.join(", ")}], golden expects [${expected.join(", ")}]`,
    );
  }
}

/**
 * The edit `email/resend/wire-email-into-auth` describes, as an executor makes it: `mailer` becomes
 * `emailMailer`, imported from the email package in place of the import of the logger that only the old
 * initializer used. `bg add` imports nothing into `mailer.ts`: the whole edit is the intention's. It fails,
 * naming what it looked for, when auth ships something else or the edit was made already, so a seam that
 * moved is not edited blind.
 */
export function wireEmailIntoAuth(source: string, scope: string): string {
  const initializer = "export const mailer: AuthMailer = unconfiguredMailer(apiLogger);";
  const logger = `import { logger as apiLogger } from "${scope}/api/lib/logger";\n`;
  for (const looked of [initializer, logger.trimEnd()]) {
    if (!source.includes(looked)) {
      throw new Error(`${MAILER_FILE} has no \`${looked}\`: the intention describes another file`);
    }
  }
  return source
    .replace(initializer, "export const mailer: AuthMailer = emailMailer;")
    .replace(logger, `import { emailMailer } from "${scope}/email";\n`);
}

/**
 * The Validation of that intention: a test in `packages/auth` that runs auth's own flows with the
 * `mailer` auth exports, and reads what the email package delivered. It is the wiring that is proved
 * (auth's `mailer` is the email module's, so a sign-up sends the verification email and a reset request
 * sends the reset one, each with a link that works), not the email package, which has tests of its own.
 */
export function wiredTest(scope: string): string {
  return `import { beforeEach, expect, test } from "bun:test";
import { clearOutbox, outbox } from "${scope}/email/testing";
import { mailer } from "./mailer";
import { createTestAuth } from "./testing";

const PASSWORD = "correct horse battery staple";

beforeEach(clearOutbox);

/** The link of the page the email opens: the first href of the html that was sent. */
function linkOf(html: string): URL {
  return new URL(/href="([^"]+)"/.exec(html)?.[1] ?? "");
}

async function signUpAndVerify(email: string) {
  const { auth, call } = await createTestAuth({ mailer });
  const signUp = await call("/sign-up/email", { body: { email, password: PASSWORD, name: "Ada" } });
  expect(signUp.status).toBe(200);
  expect(outbox.map(({ to, subject }) => [to, subject])).toEqual([
    [email, "Verify your email address"],
  ]);
  const link = linkOf(outbox[0]?.html ?? "");
  expect(link.origin + link.pathname).toBe("http://spa.test/auth/verify-email");
  await auth.api.verifyEmail({ query: { token: link.searchParams.get("token") ?? "" } });
  return { call };
}

test("a sign-up is sent the verification email, and its link verifies the user", async () => {
  const { call } = await signUpAndVerify("ada@example.com");

  const signIn = await call("/sign-in/email", {
    body: { email: "ada@example.com", password: PASSWORD },
  });
  expect(signIn.status).toBe(200);
});

test("a password reset request is sent the reset email, with the page that takes the token", async () => {
  const { call } = await signUpAndVerify("grace@example.com");
  clearOutbox();

  const reset = await call("/request-password-reset", { body: { email: "grace@example.com" } });

  expect(reset.status).toBe(200);
  expect(outbox.map(({ to, subject }) => [to, subject])).toEqual([
    ["grace@example.com", "Reset your password"],
  ]);
  const link = linkOf(outbox[0]?.html ?? "");
  expect(link.origin + link.pathname).toBe("http://spa.test/auth/reset-password");
  expect(link.searchParams.get("token")).toBeTruthy();
});
`;
}

/**
 * How golden resolves an intention the way an executor does (065): applies the edit its document
 * describes, and adds the test its Validation names. Recording it is the caller's, once the project's
 * typecheck and tests, which run that test, have passed.
 */
export type Resolution = {
  /** The module that ships the intention, whose `bg add` stages it and whose region `bg record` leaves. */
  module: string;
  /** The module that owns the file the edit lands in: it has to survive its own re-add. */
  editedOwner: string;
  /** The file the edit lands in, which the intention declares `adapt`. */
  file: string;
  apply(project: string): Promise<void>;
};

export const RESOLUTIONS: Readonly<Record<string, Resolution>> = {
  "email/resend/wire-email-into-auth": {
    module: "email/resend",
    editedOwner: "auth/better-auth",
    file: MAILER_FILE,
    async apply(project) {
      const file = join(project, MAILER_FILE);
      await Bun.write(file, wireEmailIntoAuth(await Bun.file(file).text(), SCOPE));
      await Bun.write(join(project, WIRED_TEST_FILE), wiredTest(SCOPE));
    },
  },
};

/** The way to resolve a pending intention: one golden does not know is a failed run, not a skipped one. */
function resolution(id: string): Resolution {
  const found = Object.hasOwn(RESOLUTIONS, id) ? RESOLUTIONS[id] : undefined;
  if (found === undefined) {
    throw new Error(
      `${id} is pending and golden does not know how to resolve it: add it to RESOLUTIONS`,
    );
  }
  return found;
}

/** The region `bg record` leaves on a file an intention edited (060): `intent[<id>]`, spelled out here as a consumer reads it. */
export function intentRegion(id: string): string {
  return `intent[${id}]`;
}

function regionsOf(manifest: unknown): Record<string, unknown> {
  if (!isRecord(manifest) || !isRecord(manifest.regions)) {
    throw new Error("bg.json has no `regions` object");
  }
  return manifest.regions;
}

/**
 * After `bg record`, `bg.json` holds the intention's region on the file it edited, owned by the module
 * that ships it. That region is what makes `doctor --strict` read the edit as the project's, and what
 * makes the owner's re-add keep it: a recorded sha would have the owner overwrite it.
 */
export function expectIntentRegion(
  manifest: unknown,
  id: string,
  file: string,
  owner: string,
): void {
  const owned = regionsOf(manifest)[file];
  const found = isRecord(owned) ? owned[intentRegion(id)] : undefined;
  if (found === undefined) {
    throw new Error(`bg.json records no ${intentRegion(id)} on ${file} after \`bg record ${id}\``);
  }
  if (found !== owner) {
    throw new Error(
      `bg.json records ${intentRegion(id)} on ${file} for ${String(found)}, and the intention is ${owner}'s`,
    );
  }
}

/** Before `bg record`, no file carries the region: it is what the record leaves, never what an add does. */
export function expectNoIntentRegion(manifest: unknown, id: string): void {
  for (const [file, owned] of Object.entries(regionsOf(manifest))) {
    if (isRecord(owned) && Object.hasOwn(owned, intentRegion(id))) {
      throw new Error(
        `bg.json already records ${intentRegion(id)} on ${file}, before \`bg record\``,
      );
    }
  }
}

/** The files `bg add` printed under `kept`: left as the project has them, since they carry recorded regions. */
export function readKept(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bg add did not print JSON");
  }
  if (!isRecord(parsed) || !isStringArray(parsed.kept)) {
    throw new Error("bg add printed no `kept` list");
  }
  return parsed.kept;
}

/** The re-add of the owner of an edited file kept it: with the region recorded, only regions are classified. */
export function expectKept(stdout: string, file: string): void {
  if (!readKept(stdout).includes(file)) {
    throw new Error(
      `bg add did not keep ${file}: the edit an intention made to it is the project's`,
    );
  }
}

/**
 * What `bun run db:generate` left in `packages/db/migrations`: one migration, which creates `table`.
 * `files` is the directory listing, `sql` the text of the `.sql` file in it. Returns the file's name,
 * which is what D1 records as applied. An empty schema writes nothing, and a second migration would
 * mean a stale one is being taken for the new one.
 */
export function expectGenerated(files: readonly string[], sql: string, table: string): string {
  const migrations = files.filter((file) => file.endsWith(".sql")).sort();
  const [migration, ...others] = migrations;
  if (migration === undefined) {
    throw new Error(`db:generate wrote no migration (migrations/ holds: ${files.join(", ")})`);
  }
  if (others.length > 0) {
    throw new Error(`db:generate left ${migrations.join(", ")}: expected one migration`);
  }
  if (!sql.includes(`CREATE TABLE \`${table}\``)) {
    throw new Error(`${migration} does not create ${table}:\n${sql}`);
  }
  return migration;
}

/** The rows of the one statement `wrangler d1 execute --json` ran. */
export function d1Rows(stdout: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`wrangler d1 execute did not print JSON: ${stdout.trim() || "(nothing)"}`);
  }
  const [statement] = Array.isArray(parsed) ? parsed : [];
  if (!isRecord(statement)) {
    throw new Error("wrangler d1 execute printed no statement result");
  }
  if (statement.success !== true || !Array.isArray(statement.results)) {
    throw new Error(`wrangler d1 execute reported no success: ${JSON.stringify(statement)}`);
  }
  return statement.results.filter(isRecord);
}

/** What D1 holds after `db:migrate:local`: its tables, and the migrations it recorded as applied. */
export type MigratedDatabase = { tables: readonly string[]; applied: readonly string[] };

/** The table exists and D1 recorded the generated migration: a table made another way proves nothing. */
export function expectMigrated(database: MigratedDatabase, table: string, migration: string): void {
  if (!database.applied.includes(migration)) {
    throw new Error(
      `d1_migrations holds [${database.applied.join(", ")}], not ${migration}: the migration was not applied`,
    );
  }
  if (!database.tables.includes(table)) {
    throw new Error(`${migration} was recorded as applied, but D1 has no table ${table}`);
  }
}

/** A second `db:migrate:local` finds nothing to do: what is applied is not applied again. */
export function expectNothingToApply(stdout: string): void {
  if (!stdout.includes("No migrations to apply")) {
    throw new Error(
      `the second run of db:migrate:local did not say there was nothing to apply:\n${stdout}`,
    );
  }
}

/**
 * How many tests each workspace ran, read from the prefixed output of the root `test` script: the
 * `Ran N tests` line of `bun test` (which prints it on stderr) and the `Tests  N passed` line of Vitest.
 */
export function testCounts(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of output.split("\n")) {
    const [, workspace, ran] =
      /^(\S+):test\s*\|\s*(?:Ran |Tests\s+)(\d+) (?:tests? |passed)/.exec(line) ?? [];
    if (workspace !== undefined && ran !== undefined) {
      counts[workspace] = Number(ran);
    }
  }
  return counts;
}

/** How many tests the auth package runs in the project; fewer means the root `test` stopped reaching it. */
export const AUTH_MIN_TESTS = 53;

/**
 * How many tests the storage package runs in the project: the legacy media tests (r2, routes, e2e)
 * ported, and the ones the extraction added. Fewer means the root `test` stopped reaching them.
 */
export const STORAGE_MIN_TESTS = 65;

/** The workspace ran at least `atLeast` tests: a workspace the root `test` skipped would otherwise pass in silence. */
export function expectRan(
  counts: Readonly<Record<string, number>>,
  workspace: string,
  atLeast: number,
): void {
  const ran = counts[workspace];
  if (ran === undefined || ran < atLeast) {
    throw new Error(`${workspace} ran ${ran ?? 0} tests, expected at least ${atLeast}`);
  }
}

/** The module whose launcher golden counts the tests of and asks for its plan. */
const PORTLESS_MODULE = "dev/portless";

/** Whether the configuration installs the launcher, so golden runs its tests and prints its plan. */
export function hasPortless(configuration: Configuration): boolean {
  return configuration.modules.includes(PORTLESS_MODULE);
}

/**
 * How many tests the launcher runs in the project (`bun test ./scripts/dev-portless.test.ts`: it is a
 * root script, so the root `test` fan-out over workspaces never reaches it); fewer means they went.
 */
export const PORTLESS_MIN_TESTS = 33;

/** The count in the `Ran N tests across M files` line `bun test` prints on stderr. */
export function ranTests(output: string): number {
  const ran = /Ran (\d+) tests?\b/.exec(output)?.[1];
  if (ran === undefined) {
    throw new Error(`bun test printed no \`Ran N tests\` line: ${output.trim() || "(nothing)"}`);
  }
  return Number(ran);
}

/** One app of the launcher's plan, as golden expects it: its directory, its portless name and the command. */
export type ExpectedPortlessApp = { dir: string; name: string; cmd: string[] };

/**
 * What `scripts/dev-portless.ts --dry-run` has to plan in a configuration, written out by hand and not
 * by the launcher's own rules, for a project whose root package is `slug` and a proxy serving `tld`: the
 * apps the modules install, and for each the command that follows from its `dev` script. The Worker API
 * runs through wrangler with the free port and every sibling's URL, the Bun API reads PORT, and a front
 * runs through `bunx react-router`, which portless recognises.
 */
export function expectedPortlessApps(
  configuration: string,
  slug: string,
  tld: string,
): ExpectedPortlessApp[] {
  const app = (dir: string, run: readonly string[]): ExpectedPortlessApp => ({
    dir,
    name: `${dir}.${slug}`,
    cmd: ["portless", "run", "--name", `${dir}.${slug}`, ...run],
  });
  const url = (dir: string, path = "") => `https://${dir}.${slug}.${tld}${path}`;
  const front = (dir: string) => app(dir, ["bunx", "react-router", "dev"]);

  if (configuration === "cloudflare") {
    return [
      app("api", [
        "sh",
        "-c",
        'exec bunx wrangler dev --port "$PORT" "$@"',
        "wrangler",
        "--var",
        `API_URL:${url("api")}`,
        "--var",
        `R2_PUBLIC_URL:${url("api", "/v1/media/file")}`,
        "--var",
        `SPA_URL:${url("spa")}`,
        "--var",
        `SSR_URL:${url("ssr")}`,
        "--var",
        `STATIC_URL:${url("static")}`,
      ]),
      front("spa"),
      front("ssr"),
      front("static"),
    ];
  }
  if (configuration === "dockerfile") {
    return [app("api", ["bun", "--watch", "src/index.ts"]), front("spa")];
  }
  throw new Error(`golden does not know what the launcher plans in ${configuration}`);
}

type PlannedPortlessApp = ExpectedPortlessApp & {
  url: string;
  cwd: string;
  env: Record<string, string>;
};

/** The apps in the JSON `bun scripts/dev-portless.ts --dry-run` prints. */
function readPortlessPlan(stdout: string): PlannedPortlessApp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("dev-portless --dry-run did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.apps)) {
    throw new Error("dev-portless --dry-run printed no `apps` list");
  }
  return parsed.apps.map((entry: unknown): PlannedPortlessApp => {
    if (
      !isRecord(entry) ||
      typeof entry.dir !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.url !== "string" ||
      typeof entry.cwd !== "string" ||
      !isStringArray(entry.cmd) ||
      !isRecord(entry.env)
    ) {
      throw new Error(
        "dev-portless --dry-run printed an app without dir, name, url, cwd, cmd and env",
      );
    }
    const env = Object.fromEntries(
      Object.entries(entry.env).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    );
    return {
      dir: entry.dir,
      name: entry.name,
      url: entry.url,
      cwd: entry.cwd,
      cmd: entry.cmd,
      env,
    };
  });
}

/**
 * The launcher's dry run planned exactly the apps `expected` names, each with the name, the address under
 * `tld`, the directory and the command golden expects, and told every app but the API where the API is
 * (`API_URL` and `VITE_API_URL`: a Worker is told through `--var`, which the command carries).
 */
export function expectPortlessPlan(
  stdout: string,
  expected: readonly ExpectedPortlessApp[],
  tld: string,
): void {
  const planned = readPortlessPlan(stdout);
  const dirs = planned.map(({ dir }) => dir);
  const missing = expected.filter(({ dir }) => !dirs.includes(dir)).map(({ dir }) => dir);
  const unexpected = dirs.filter((dir) => !expected.some((app) => app.dir === dir));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `dev-portless planned [${dirs.join(", ")}], golden expects [${expected.map(({ dir }) => dir).join(", ")}]` +
        (missing.length > 0 ? `; it did not plan ${missing.join(", ")}` : "") +
        (unexpected.length > 0
          ? `; it planned ${unexpected.join(", ")}, which golden did not expect`
          : ""),
    );
  }
  for (const want of expected) {
    const got = planned.find(({ dir }) => dir === want.dir);
    if (got === undefined) {
      continue;
    }
    if (got.name !== want.name || got.cwd !== `apps/${want.dir}`) {
      throw new Error(
        `${want.dir}: planned name ${got.name} in ${got.cwd}, expected ${want.name} in apps/${want.dir}`,
      );
    }
    if (got.url !== `https://${want.name}.${tld}`) {
      throw new Error(`${want.dir}: planned url ${got.url}, expected https://${want.name}.${tld}`);
    }
    if (JSON.stringify(got.cmd) !== JSON.stringify(want.cmd)) {
      throw new Error(
        `${want.dir}: planned \`${got.cmd.join(" ")}\`, expected \`${want.cmd.join(" ")}\``,
      );
    }
  }
  const api = planned.find(({ dir }) => dir === "api");
  for (const app of api === undefined ? [] : planned.filter(({ dir }) => dir !== "api")) {
    for (const key of ["API_URL", "VITE_API_URL"]) {
      if (app.env[key] !== api?.url) {
        throw new Error(
          `${app.dir}: ${key} is ${app.env[key] ?? "not set"}, expected the API's ${api?.url}`,
        );
      }
    }
  }
}

/** How a command ended, for one that is expected to fail. */
export type Attempt = { code: number; stderr: string };

/**
 * An item that lands in `packages/ui` is refused until a `ui` module is named (030). Golden tries it
 * with the packed CLI in a project that has none, before installing anything: the refusal has to
 * carry the command that fixes it, as an agent running `bg add` reads it and nothing else.
 */
export function expectRefusal(attempt: Attempt, item: string, module: string): void {
  if (attempt.code === 0) {
    throw new Error(
      `\`bg add ${item}\` succeeded in a project with no ${module}: it must be refused`,
    );
  }
  const fix = `bg add ${module} ${item}`;
  if (!attempt.stderr.includes(fix)) {
    throw new Error(
      `\`bg add ${item}\` was refused without naming \`${fix}\`; it printed: ${attempt.stderr.trim() || "(nothing)"}`,
    );
  }
}

/** The port the image listens on: the Dockerfile's `PORT`. */
const CONTAINER_PORT = 5172;

/**
 * Why the image phases cannot run, or null when they can. `probe` is how `docker info` ended, or
 * null when `docker` is not on PATH. Only the absence of a daemon skips: a build or a container that
 * fails with one running is a failed run.
 */
export function dockerSkipReason(probe: Attempt | null): string | null {
  if (probe === null) {
    return "docker unavailable: not on PATH";
  }
  return probe.code === 0 ? null : `docker unavailable: \`docker info\` exited with ${probe.code}`;
}

/** The environment variable that turns a skipped image phase into a failed run: CI sets it. */
export const DOCKER_REQUIRED = "GOLDEN_REQUIRE_DOCKER";

/**
 * Whether the variable asks for docker: unset, empty, `0` and `false` do not, anything else does, so
 * a spelling nobody planned (`yes`) fails safe, as a run that requires docker, and not as one that skips.
 */
export function requiresDocker(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

/**
 * What to do about the image phases: null to run them, the reason to skip them, and a throw when
 * `required` and docker is unavailable, so that CI cannot go green without having built the image.
 */
export function dockerDecision(probe: Attempt | null, required: boolean): string | null {
  const reason = dockerSkipReason(probe);
  if (reason !== null && required) {
    throw new Error(`${reason}, and ${DOCKER_REQUIRED} is set`);
  }
  return reason;
}

/** The name of the image, the container and the volume of one run: unique to this process. */
export function dockerName(pid: number): string {
  return `bg-golden-${pid}`;
}

/** The host port of the binding `docker port <name> <port>/tcp` prints, the first one when there are several. */
export function publishedPort(output: string): number {
  const port = /:(\d+)\s*$/m.exec(output)?.[1];
  if (port === undefined) {
    throw new Error(`docker port printed no port: ${output.trim() || "(nothing)"}`);
  }
  return Number(port);
}

/** What golden reads of a response. */
export type Served = { status: number; contentType: string | null };

/** The response has to carry `status` and the media type `type`, whatever parameters follow it (`; charset=utf-8`). */
export function expectServed(what: string, served: Served, status: number, type: string): void {
  const media = served.contentType?.split(";")[0]?.trim().toLowerCase() ?? "no content type";
  if (served.status !== status || media !== type) {
    throw new Error(`${what}: expected ${status} ${type}, got ${served.status} ${media}`);
  }
}

/** The first script of /assets that the built index.html loads: a hashed file, so its name is read, not written. */
export function assetPath(html: string): string {
  const path = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  if (path === undefined) {
    throw new Error("the index.html served loads no script from /assets");
  }
  return path;
}

/**
 * Asks `check` until it passes or `timeoutMs` has gone by, `intervalMs` apart. A check that throws is
 * not ready yet (a connection refused while the server starts). Each ask has to bound itself: this
 * does not interrupt one.
 */
export async function until(
  check: () => Promise<boolean>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    try {
      if (await check()) {
        return true;
      }
    } catch {
      // not ready yet
    }
    if (performance.now() >= deadline) {
      return false;
    }
    await Bun.sleep(intervalMs);
  }
}

/** One row of the timing table. A `note` stands where the seconds do, for a phase that did not run. */
type Timing = { phase: string; ms: number; note?: string };

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The environment of a command that runs `wrangler` against local state: no metrics, so nothing leaves the machine. */
const OFFLINE = { WRANGLER_SEND_METRICS: "false" };

async function run(argv: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
}

async function capture(argv: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
  return stdout;
}

/** Both streams of a command that has to succeed: `bun test` prints its report on stderr. */
async function captureBoth(
  argv: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  process.stderr.write(stderr);
  process.stdout.write(stdout);
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
  return { stdout, stderr };
}

async function attempt(argv: string[], cwd: string, timeoutMs?: number): Promise<Attempt> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
}

async function phase<T>(timings: Timing[], name: string, body: () => Promise<T>): Promise<T> {
  console.log(`\n==> golden: ${name}`);
  const start = performance.now();
  try {
    return await body();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`phase "${name}" failed: ${reason}`);
  } finally {
    timings.push({ phase: name, ms: performance.now() - start });
  }
}

async function golden(work: string, timings: Timing[]): Promise<void> {
  const cli = join(work, "cli");
  const bg = (...args: string[]) => [BUN, join(cli, "src/bin.ts"), ...args];
  const registry = `local:${join(ROOT, "registry")}`;

  await phase(timings, "pack", async () => {
    await run([BUN, "run", "pack:cli"], ROOT);
    await cp(PACKED_CLI, cli, { recursive: true });
    // What `bunx create-bonne-garde` does first: the packed package has dependencies of its own,
    // and this copy sits in a temp directory with no node_modules to find them in.
    await run([BUN, "install"], cli);
  });

  const { items, excluded } = await phase(timings, "list", async () => {
    const fromItems = selectItems(
      await capture(bg("list", "--items", "--source", registry), work),
      EXCLUDED,
    );
    const fromModules = selectModules(
      await capture(bg("list", "--source", registry), work),
      MODULES,
      EXCLUDED_MODULES,
    );
    return { items: fromItems.items, excluded: [...fromItems.excluded, ...fromModules.excluded] };
  });
  for (const { name, reason } of excluded) {
    console.log(`golden: leaving out ${name}: ${reason}`);
  }

  for (const [index, configuration] of CONFIGURATIONS.entries()) {
    await configured(work, timings, { bg, registry, items, configuration, first: index === 0 });
  }
}

/** One configuration, from `bg create` to the modules' `checks`. */
async function configured(
  work: string,
  timings: Timing[],
  options: {
    bg: (...args: string[]) => string[];
    registry: string;
    items: readonly string[];
    configuration: Configuration;
    first: boolean;
  },
): Promise<void> {
  const { bg, registry, configuration, first } = options;
  const { name, modules } = configuration;
  const installed = configuration.items ? options.items : [];
  const patched = PATCHED[name] ?? {};
  const pending = PENDING[name] ?? [];
  const project = join(work, `golden-${name}`);
  const step = <T>(label: string, body: () => Promise<T>) =>
    phase(timings, `${name}: ${label}`, body);

  console.log(`\ngolden: configuration ${name}: ${modules.join(" ")}`);
  await step("create", () =>
    run(
      bg(
        "create",
        project,
        "--yes",
        "--no-git",
        "--no-install",
        "--scope",
        SCOPE,
        "--registry",
        registry,
      ),
      work,
    ),
  );
  // The refusal does not depend on the provider: once is enough.
  if (first) {
    await step("refuse", async () => {
      if (!options.items.includes(REFUSED_ITEM) || !modules.includes(REFUSED_MODULE)) {
        throw new Error(
          `the refusal check needs ${REFUSED_ITEM} and ${REFUSED_MODULE} in the install`,
        );
      }
      const manifest = await Bun.file(join(project, "bg.json")).text();
      expectRefusal(
        await attempt(bg("add", REFUSED_ITEM, "--yes", "--no-install"), project),
        REFUSED_ITEM,
        REFUSED_MODULE,
      );
      if ((await Bun.file(join(project, "bg.json")).text()) !== manifest) {
        throw new Error(`the refused \`bg add ${REFUSED_ITEM}\` changed bg.json`);
      }
    });
  }
  if (first && hasAuth(configuration)) {
    await refusedPeer(work, timings, bg, registry);
  }
  const added = await step("add", async () => {
    const stdout = await capture(bg(...addArguments(modules, installed)), project);
    process.stdout.write(stdout);
    const reported = readAddedModules(stdout, modules);
    expectPatches(reported, "applied", patched);
    expectPending(readPendingIntentions(stdout), pending);
    const manifest: unknown = JSON.parse(await Bun.file(join(project, "bg.json")).text());
    expectRegionsRecorded(manifest, reported);
    // Pending is not recorded: no file carries an intention's region before `bg record` leaves it.
    for (const id of pending) {
      expectNoIntentRegion(manifest, id);
    }
    return reported;
  });
  // Before `bun install`, so that node_modules and the lockfile are not in the comparison.
  await step("re-add", async () => {
    const before = await snapshot(project);
    const stdout = await capture(bg(...addArguments(modules, installed)), project);
    expectPatches(readAddedModules(stdout, modules), "skipped", patched);
    // Staged again, and the same bytes: the intention is still pending, and nothing moved.
    expectPending(readPendingIntentions(stdout), pending);
    const changed = diffTrees(before, await snapshot(project));
    if (changed.length > 0) {
      throw new Error(`the same \`bg add\` again changed the project: ${changed.join(", ")}`);
    }
  });
  // Each module on its own, after the whole set was installed in one call: a file one module vendors
  // and another patched (db/d1's package.json, api/elysia's app.ts) is the project's by then, and the
  // owner asked for alone has to keep it, skip its patches and change nothing.
  await step("re-add alone", async () => {
    for (const module of modules) {
      const before = await snapshot(project);
      const stdout = await capture(bg(...addArguments([module], [])), project);
      const expected = Object.fromEntries(
        Object.entries(patched).filter(([name]) => name === module),
      );
      expectPatches(readAddedModules(stdout, [module]), "skipped", expected);
      const changed = diffTrees(before, await snapshot(project));
      if (changed.length > 0) {
        throw new Error(`\`bg add ${module}\` alone changed the project: ${changed.join(", ")}`);
      }
    }
  });
  // What an executor does with each pending intention (065), once every install is known to be stable:
  // the edit its document describes, and the test its Validation names. Recording waits for that
  // Validation, which is the project's own typecheck, tests and check below.
  if (pending.length > 0) {
    await step("intentions: apply", async () => {
      for (const id of pending) {
        await resolution(id).apply(project);
      }
    });
  }
  await step("install", () => run([BUN, "install"], project));
  await step("typecheck", () => run([BUN, "run", "typecheck"], project));
  await step("test", async () => {
    const { stdout, stderr } = await captureBoth([BUN, "run", "test"], project);
    const ran = testCounts(`${stdout}\n${stderr}`);
    if (hasAuth(configuration)) {
      expectRan(ran, `${SCOPE}/auth`, AUTH_MIN_TESTS);
    }
    if (hasEmail(configuration)) {
      expectRan(ran, `${SCOPE}/email`, EMAIL_MIN_TESTS);
    }
    if (hasStorage(configuration)) {
      expectRan(ran, `${SCOPE}/storage`, STORAGE_MIN_TESTS);
    }
    const counts = Object.entries(ran);
    console.log(
      `golden: tests run: ${counts.map(([workspace, ran]) => `${workspace} ${ran}`).join(", ")}`,
    );
  });
  await step("build", () => run([BUN, "run", "build"], project));
  // Typecheck, test and build passed with the edit and its test in place, and the formatter has to
  // accept the edit too: that is the intention's Validation, so it is recorded now and not before.
  if (pending.length > 0) {
    await step("intentions: record", async () => {
      await run([BUN, "run", "check"], project);
      for (const id of pending) {
        await run(bg("record", id), project);
        // The edited file is region-checked from here on: bg.json holds the intention's region on it.
        const { module, file } = resolution(id);
        expectIntentRegion(
          JSON.parse(await Bun.file(join(project, "bg.json")).text()),
          id,
          file,
          module,
        );
      }
    });
  }
  await step("doctor", () => run(bg("doctor", "--strict"), project));
  // The owner of the file the edit landed in, and the module that shipped the intention, asked for again:
  // the edit is the project's by now, so each has to keep it, skip its patches, stage nothing and change nothing.
  if (pending.length > 0) {
    await step("intentions: re-add", async () => {
      for (const id of pending) {
        const { module, editedOwner, file } = resolution(id);
        for (const owner of [module, editedOwner]) {
          const before = await snapshot(project);
          const stdout = await capture(bg(...addArguments([owner], [])), project);
          const expected = Object.fromEntries(
            Object.entries(patched).filter(([key]) => key === owner),
          );
          expectPatches(readAddedModules(stdout, [owner]), "skipped", expected);
          expectPending(readPendingIntentions(stdout), []);
          if (owner === editedOwner) {
            // The owner of the edited file wrote it and its recorded sha no longer matches: the region
            // is what makes the add keep it and say so, instead of refusing or overwriting it.
            expectKept(stdout, file);
          }
          const changed = diffTrees(before, await snapshot(project));
          if (changed.length > 0) {
            throw new Error(
              `\`bg add ${owner}\` after ${id} was recorded changed the project: ${changed.join(", ")}`,
            );
          }
        }
      }
    });
  }
  if (hasAuth(configuration)) {
    await regenerated(project, timings, name);
  }
  if (hasDatabase(configuration)) {
    await migrated(project, timings, name, expectedTables(configuration));
    if (hasAuth(configuration)) {
      await seeded(project, timings, name, configuration);
    }
  }
  await step("check", () => run([BUN, "run", "check"], project));
  if (hasPortless(configuration)) {
    await launched(project, timings, name);
  }
  for (const { module, checks } of added.filter(({ checks }) => checks.length > 0)) {
    await step(`checks:${module}`, async () => {
      for (const command of checks) {
        await run(["sh", "-c", command], project);
      }
    });
  }
  if (buildsImage(configuration)) {
    await imaged(project, timings, name);
  }
}

/**
 * The launcher of `dev/portless`, in the project it was installed into: its own tests counted (a root
 * script is outside the root `test` fan-out, so nothing else runs them), and its dry run, which needs
 * neither portless nor a proxy, compared with the apps this configuration installs: their names, addresses,
 * directories and commands, on `.localhost` and, with `--lan`, on `.local`.
 */
async function launched(project: string, timings: Timing[], name: string): Promise<void> {
  const slug = basename(project);
  const plan = (...flags: string[]) =>
    capture([BUN, "scripts/dev-portless.ts", "--dry-run", ...flags], project);

  await phase(timings, `${name}: portless tests`, async () => {
    const { stderr } = await captureBoth([BUN, "test", "./scripts/dev-portless.test.ts"], project);
    expectRan({ [PORTLESS_MODULE]: ranTests(stderr) }, PORTLESS_MODULE, PORTLESS_MIN_TESTS);
  });
  await phase(timings, `${name}: portless plan`, async () => {
    expectPortlessPlan(await plan(), expectedPortlessApps(name, slug, "localhost"), "localhost");
    expectPortlessPlan(await plan("--lan"), expectedPortlessApps(name, slug, "local"), "local");
  });
}

/**
 * 035 and 050 acceptance: `bg add better-auth` in a project that has everything but an `orm` fails,
 * names the missing peer's category, and writes nothing. It needs a project of its own, because the
 * configuration under test has the ORM, and runs before the `add` of that one.
 */
async function refusedPeer(
  work: string,
  timings: Timing[],
  bg: (...args: string[]) => string[],
  registry: string,
): Promise<void> {
  const project = join(work, "golden-peer");
  await phase(timings, "peer: create", () =>
    run(
      bg(
        "create",
        project,
        "--yes",
        "--no-git",
        "--no-install",
        "--scope",
        SCOPE,
        "--registry",
        registry,
      ),
      work,
    ),
  );
  await phase(timings, "peer: add the modules but the orm", () =>
    run(bg("add", ...WITHOUT_ORM, "--yes", "--no-install"), project),
  );
  await phase(timings, "peer: refuse", async () => {
    const before = await snapshot(project);
    expectPeerRefusal(
      await attempt(bg("add", "better-auth", "--yes", "--no-install"), project),
      "better-auth",
      "orm",
    );
    const changed = diffTrees(before, await snapshot(project));
    if (changed.length > 0) {
      throw new Error(
        `the refused \`bg add better-auth\` changed the project: ${changed.join(", ")}`,
      );
    }
  });
}

/**
 * `bun run auth:generate` in the project, which runs the pinned Better Auth CLI on node and the
 * formatter, has to write the schema the module shipped: byte for byte, or the module carries an edit
 * the next regeneration would drop.
 */
async function regenerated(project: string, timings: Timing[], name: string): Promise<void> {
  await phase(timings, `${name}: auth generate`, async () => {
    const file = join(project, AUTH_SCHEMA_FILE);
    const shipped = await Bun.file(file).text();
    await run([BUN, "run", "auth:generate"], join(project, "packages/auth"));
    expectRegenerated(shipped, await Bun.file(file).text());
  });
}

/**
 * The database of a project with an `orm`: a table added to the schema barrel, `bun run db:generate`
 * writing its migration, `bun run db:migrate:local` applying it to the local D1 `wrangler` keeps under
 * `apps/api/.wrangler` (no network, no Cloudflare account, the placeholder `database_id` of the
 * module), and the database read back: the table is there and the migration is the one D1 recorded.
 * It runs after `doctor`, which would report the barrel as edited, and before `check`, which has to
 * pass over what `db:generate` wrote.
 */
async function migrated(
  project: string,
  timings: Timing[],
  name: string,
  tables: readonly string[],
): Promise<void> {
  const db = join(project, "packages/db");
  const api = join(project, "apps/api");
  let migration = "";

  await phase(timings, `${name}: db generate`, async () => {
    await Bun.write(join(project, GOLDEN_SCHEMA_FILE), GOLDEN_SCHEMA);
    const barrel = join(project, GOLDEN_BARREL_FILE);
    await Bun.write(barrel, `${await Bun.file(barrel).text()}${GOLDEN_BARREL_LINE}`);
    await run([BUN, "run", "db:generate"], db);
    const directory = join(db, "migrations");
    const files = await readdir(directory);
    const [first] = files.filter((file) => file.endsWith(".sql"));
    const sql = first === undefined ? "" : await Bun.file(join(directory, first)).text();
    for (const table of tables) {
      migration = expectGenerated(files, sql, table);
    }
  });

  await phase(timings, `${name}: db migrate`, async () => {
    await run([BUN, "run", "db:migrate:local"], api, OFFLINE);
    const rows = async (statement: string, column: string): Promise<string[]> =>
      d1Rows(
        await capture(
          ["bunx", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command", statement],
          api,
          OFFLINE,
        ),
      ).flatMap((row) => (typeof row[column] === "string" ? [row[column]] : []));
    const database = {
      tables: await rows("SELECT name FROM sqlite_master WHERE type = 'table'", "name"),
      applied: await rows("SELECT name FROM d1_migrations ORDER BY id", "name"),
    };
    for (const table of tables) {
      expectMigrated(database, table, migration);
    }
    expectNothingToApply(await capture([BUN, "run", "db:migrate:local"], api, OFFLINE));
  });
}

/**
 * `bun run db:seed` against the local D1 the migration phase filled, which has the auth tables because
 * the module re-exports them from the schema barrel; then a row in every other table the barrel exports,
 * a media with an author and no organization among them; then `bun run db:reset`, the orm's, which has
 * to leave every table empty; then `db:seed` again, which has to leave the admin once; then once more on
 * the seeded database, which has to say so and leave every table with the rows it had. The SQL is tested
 * against SQLite and Better Auth in the modules; this is the runners (`wrangler d1 execute` by the
 * binding `DB`) and D1 itself, which enforces the foreign keys the order of the deletes is for.
 */
async function seeded(
  project: string,
  timings: Timing[],
  name: string,
  configuration: Configuration,
): Promise<void> {
  const api = join(project, "apps/api");
  const auth = join(project, "packages/auth");
  const db = join(project, "packages/db");
  const select = async (statement: string) =>
    d1Rows(
      await capture(
        ["bunx", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command", statement],
        api,
        OFFLINE,
      ),
    );
  const execute = (statement: string) =>
    run(
      ["bunx", "wrangler", "d1", "execute", "DB", "--local", "--command", statement],
      api,
      OFFLINE,
    );
  const seedAdmin = async () => {
    await run([BUN, "run", "db:seed"], auth, OFFLINE);
    expectSeeded(
      await select('SELECT email, email_verified FROM "user"'),
      await select('SELECT role FROM "member"'),
    );
  };

  await phase(timings, `${name}: auth db:seed`, seedAdmin);

  await phase(timings, `${name}: db reset`, async () => {
    const tables = resetTables(configuration);
    const storage = hasStorage(configuration);
    await execute(GOLDEN_NOTE_STATEMENT);
    if (storage) {
      await execute(GOLDEN_MEDIA_STATEMENT);
    }
    // The inserts above select from or add to what the seed left: one that matched nothing would make
    // the reset below prove less than it appears to.
    expectRows(readCounts(await select(countStatement(tables))), {
      user: 1,
      [GOLDEN_TABLE]: 1,
      ...(storage ? { medias: 1 } : {}),
    });

    await run([BUN, "run", "db:reset"], db, OFFLINE);

    expectRows(
      readCounts(await select(countStatement(tables))),
      Object.fromEntries(tables.map((table) => [table, 0])),
    );
  });

  await phase(timings, `${name}: auth db:seed again`, seedAdmin);

  await phase(timings, `${name}: auth db:seed on a seeded database`, async () => {
    const tables = resetTables(configuration);
    const before = readCounts(await select(countStatement(tables)));
    expectAlreadySeeded(await capture([BUN, "run", "db:seed"], auth, OFFLINE));
    expectRows(readCounts(await select(countStatement(tables))), before);
  });
}

/**
 * The image of a project that ships a Dockerfile: built, run on a host port docker picks, asked for
 * what a deployed container answers, then removed. Everything it creates is named `bg-golden-<pid>`
 * and removed by that name, the container first since it holds the image and the volume. Nothing
 * else on the machine is touched: no prune, no cache clear.
 */
async function imaged(project: string, timings: Timing[], name: string): Promise<void> {
  const label = `${name}: docker`;
  const probe =
    Bun.which("docker") === null ? null : await attempt(["docker", "info"], project, 20_000);
  let skipped: string | null;
  try {
    skipped = dockerDecision(probe, requiresDocker(process.env[DOCKER_REQUIRED]));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`phase "${label}" failed: ${reason}`);
  }
  if (skipped !== null) {
    console.log(`\n${label}  skipped (${skipped})`);
    timings.push({ phase: label, ms: 0, note: `skipped (${skipped})` });
    return;
  }

  const docker = dockerName(process.pid);
  try {
    await phase(timings, `${label} build`, () =>
      run(["docker", "build", "-t", docker, "."], project),
    );
    await phase(timings, `${label} run`, async () => {
      try {
        await answers(project, docker);
      } catch (error) {
        console.log(`\ngolden: last lines of the container ${docker}`);
        await run(["docker", "logs", "--tail", "40", docker], project).catch(() => undefined);
        throw error;
      }
    });
  } finally {
    for (const [kind, argv] of [
      ["container", ["docker", "rm", "-f", docker]],
      ["volume", ["docker", "volume", "rm", docker]],
      ["image", ["docker", "image", "rm", docker]],
    ] as const) {
      const { code, stderr } = await attempt([...argv], project);
      // Nothing to remove when the build or the run failed before it existed.
      if (code !== 0 && !/no such/i.test(stderr)) {
        console.warn(`golden: could not remove the ${kind} ${docker}: ${stderr.trim()}`);
      }
    }
  }
}

/** Starts the container, waits for `/health`, and checks what it serves: the API, the SPA, a hashed asset, a client route. */
async function answers(project: string, docker: string): Promise<void> {
  await run(
    [
      "docker",
      "run",
      "-d",
      "--name",
      docker,
      "-v",
      `${docker}:/data`,
      "-p",
      `127.0.0.1::${CONTAINER_PORT}`,
      docker,
    ],
    project,
  );
  const port = publishedPort(
    await capture(["docker", "port", docker, `${CONTAINER_PORT}/tcp`], project),
  );
  const get = async (path: string, accept?: string): Promise<Served & { body: string }> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: accept === undefined ? {} : { accept },
      signal: AbortSignal.timeout(2000),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  };

  const ready = await until(async () => (await get("/health")).status === 200, {
    timeoutMs: 60_000,
    intervalMs: 500,
  });
  if (!ready) {
    throw new Error("the container did not answer GET /health with 200 within 60 s");
  }
  expectServed("GET /health", await get("/health"), 200, "application/json");
  const home = await get("/");
  expectServed("GET /", home, 200, "text/html");
  const asset = assetPath(home.body);
  expectServed(`GET ${asset}`, await get(asset), 200, "text/javascript");
  // A client route has no file: the runtime answers a navigation with the SPA's index.html.
  const route = "/golden/unknown-client-route";
  const client = await get(route, "text/html");
  expectServed(`GET ${route} (Accept: text/html)`, client, 200, "text/html");
  if (client.body !== home.body) {
    throw new Error(`GET ${route} (Accept: text/html) answered something other than GET /`);
  }
}

async function main(): Promise<number> {
  const work = await mkdtemp(join(tmpdir(), "bg-golden-"));
  const timings: Timing[] = [];
  const start = performance.now();
  let failure: unknown;

  try {
    await golden(work, timings);
  } catch (error) {
    failure = error;
  }

  console.log("\ngolden: phase timings");
  const width = Math.max(10, ...timings.map(({ phase: name }) => name.length));
  for (const { phase: name, ms, note } of timings) {
    console.log(`  ${name.padEnd(width)} ${note ?? seconds(ms)}`);
  }
  console.log(`  ${"total".padEnd(width)} ${seconds(performance.now() - start)}`);

  if (failure !== undefined) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    console.error(`\ngolden: FAILED, ${reason}\ngolden: project kept at ${work}`);
    return 1;
  }
  await rm(work, { recursive: true, force: true });
  console.log("golden: ok");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
