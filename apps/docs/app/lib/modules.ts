import { type ModuleCategory, type ModuleVariant } from "@bonne-garde/schema";

export function modulePath(category: string, id: string): string {
  return `/modules/${category}/${id}`;
}

/** Where a category installs, from the table of `docs/CONCEPTS.md#categories`. */
export const CATEGORY_HOME = {
  pm: "repo",
  provider: "repo",
  tooling: "repo",
  config: "package packages/config",
  api: "app apps/api",
  db: "package packages/db",
  orm: "package packages/db",
  auth: "package packages/auth",
  ui: "package packages/ui",
  email: "package packages/email",
  queue: "package packages/queue",
  storage: "package packages/storage",
  realtime: "package packages/realtime",
  payments: "package packages/payments",
  observability: "package packages/observability",
  web: "app apps/<id>",
  testing: "app",
  deploy: "repo",
  dev: "repo",
} as const satisfies Record<ModuleCategory, string>;

export type EnvRow = { name: string; required: boolean; example: string };

/** One row per variable across variants: required as soon as one variant requires it. */
export function mergeEnv(variants: ModuleVariant[]): EnvRow[] {
  const rows = new Map<string, EnvRow>();
  for (const variable of variants.flatMap((variant) => variant.env ?? [])) {
    const known = rows.get(variable.name);
    rows.set(variable.name, {
      name: variable.name,
      required: (known?.required ?? false) || (variable.required ?? false),
      example: known?.example || variable.example || "",
    });
  }
  return [...rows.values()];
}
