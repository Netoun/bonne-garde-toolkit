/**
 * What `create` asks, and the registry names each answer stands for. Which answers go
 * together is the registry's to say: a set is checked as `bonne-garde add` would plan it (`Check`), so no
 * compatibility rule lives here.
 */
import type { PackageManager } from "./package-manager";

/** An answer as the terminal shows it: what it is called, and what it brings. */
export type Choice<T extends string> = { value: T; label: string; hint: string };

const PM_CHOICES = [
  { value: "bun", label: "bun", hint: "Bun installs the project and runs its scripts" },
  { value: "pnpm", label: "pnpm", hint: "pnpm installs the project, Node runs everything" },
] as const satisfies readonly Choice<PackageManager>[];

const APP_CHOICES = [
  { value: "api", label: "API", hint: "Elysia, typed for the fronts through Eden" },
  { value: "spa", label: "SPA", hint: "React Router, rendered in the browser" },
  { value: "ssr", label: "SSR", hint: "React Router, rendered on the server" },
  { value: "static", label: "Static site", hint: "React Router, prerendered" },
] as const;

const PROVIDER_CHOICES = [
  { value: "cloudflare", label: "Cloudflare", hint: "Workers and Pages" },
  { value: "dockerfile", label: "Docker", hint: "one Node container, the API and the SPA" },
] as const;

const FEATURE_CHOICES = [
  { value: "db", label: "Database", hint: "Drizzle on D1, or on an SQLite file with Docker" },
  { value: "auth", label: "Auth", hint: "Better Auth, organizations, the SPA's sign-in pages" },
  { value: "storage", label: "Storage", hint: "media uploads on R2" },
  { value: "email", label: "Email", hint: "transactional email with Resend" },
  { value: "deploy", label: "Deploy", hint: "a GitHub Actions workflow to Cloudflare" },
  { value: "backoffice", label: "Backoffice", hint: "the SPA's signed-in area" },
  { value: "portless", label: "Portless", hint: "a named https URL for each app in dev" },
] as const;

export type App = (typeof APP_CHOICES)[number]["value"];
export type Provider = (typeof PROVIDER_CHOICES)[number]["value"];
export type Feature = (typeof FEATURE_CHOICES)[number]["value"];

export const APPS: readonly App[] = APP_CHOICES.map(({ value }) => value);
export const PROVIDERS: readonly Provider[] = PROVIDER_CHOICES.map(({ value }) => value);
export const FEATURES: readonly Feature[] = FEATURE_CHOICES.map(({ value }) => value);

export type Choices = {
  apps: readonly App[];
  provider: Provider | null;
  features: readonly Feature[];
  pm: PackageManager;
};

/** Every module an answer can name, in the order `bonne-garde add` is given them. */
export const CANDIDATE_MODULES = [
  "pm/bun",
  "pm/pnpm",
  "provider/cloudflare",
  "provider/dockerfile",
  "tooling/vite-plus",
  "config/branding",
  "ui/shadcn",
  "api/elysia",
  "db/d1",
  "db/libsql",
  "orm/drizzle",
  "auth/better-auth",
  "storage/r2",
  "web/spa",
  "web/ssr",
  "web/static",
  "dev/portless",
  "email/resend",
  "deploy/cloudflare-actions",
] as const;

const FRONTS: Partial<Record<App, string>> = {
  spa: "web/spa",
  ssr: "web/ssr",
  static: "web/static",
};

const FEATURE_MODULES: Record<Feature, readonly string[]> = {
  db: ["orm/drizzle"],
  auth: ["auth/better-auth"],
  storage: ["storage/r2"],
  email: ["email/resend"],
  deploy: ["deploy/cloudflare-actions"],
  backoffice: [],
  portless: ["dev/portless"],
};

/** The `db` feature's database module: provider technology lives in the provider's modules. */
const DB_MODULES: Record<Provider, string> = { cloudflare: "db/d1", dockerfile: "db/libsql" };

/** 040's table: the modules and items of a set of answers. Every project has its package manager's. */
export function namesFor({ apps, provider, features, pm }: Choices): {
  modules: string[];
  items: string[];
} {
  if (apps.length === 0 || provider === null) {
    return { modules: [`pm/${pm}`], items: [] };
  }
  const named = new Set<string>([
    `pm/${pm}`,
    `provider/${provider}`,
    "tooling/vite-plus",
    "config/branding",
  ]);
  for (const app of apps) {
    const front = FRONTS[app];
    if (front) {
      named.add("ui/shadcn").add(front);
    }
    if (app === "api") {
      named.add("api/elysia");
    }
  }
  for (const feature of features) {
    if (feature === "db") {
      named.add(DB_MODULES[provider]);
    }
    for (const module of FEATURE_MODULES[feature]) {
      named.add(module);
    }
  }
  const items: string[] = [];
  if (features.includes("auth") && apps.includes("spa")) {
    items.push("spa-auth");
  }
  if (features.includes("backoffice")) {
    items.push("spa-backoffice");
  }
  return { modules: CANDIDATE_MODULES.filter((module) => named.has(module)), items };
}

/** A `--apps` / `--features` value: a comma-separated list of known values, each once. */
export function parseFlagList<T extends string>(
  flag: string,
  value: string,
  allowed: readonly T[],
): T[] {
  const values: T[] = [];
  for (const token of value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const known = allowed.find((candidate) => candidate === token);
    if (known === undefined) {
      throw new Error(`${flag}: unknown value ${token}: pass one of ${allowed.join(", ")}`);
    }
    if (!values.includes(known)) {
      values.push(known);
    }
  }
  return values;
}

/** Throws the planner's message when `bonne-garde add` would refuse these names in an empty project. */
export type Check = (names: string[]) => void;

/**
 * The questions `create` asks on a terminal. `one` picks a single answer, `initial` first;
 * `many` picks any number, none included; `search` is `many` over a long list, narrowed by typing;
 * `warn` says why a set was refused before it is asked again.
 */
export type Prompter = {
  one<T extends string>(message: string, choices: readonly Choice<T>[], initial: T): Promise<T>;
  many<T extends string>(message: string, choices: readonly Choice<T>[]): Promise<T[]>;
  search<T extends string>(message: string, choices: readonly Choice<T>[]): Promise<T[]>;
  warn(message: string): void;
};

function refusal(check: Check, choices: Choices): string | null {
  const { modules, items } = namesFor(choices);
  try {
    check([...modules, ...items]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * 040's resolution: an axis a flag gave is never asked; with no prompter (`--yes`, or no TTY) a
 * missing axis takes its default and a refused set fails; with one, a refused set is said and its axis
 * asked again. The package manager comes first, its default the one `create` was started from
 * (`defaultPm`). The registry's check is loaded only once an app is chosen.
 */
export async function resolveChoices(options: {
  given: Partial<Choices>;
  prompter: Prompter | null;
  defaultPm: PackageManager;
  loadCheck: () => Promise<Check>;
}): Promise<Choices> {
  const { given, prompter, defaultPm } = options;
  const pm =
    given.pm ??
    (prompter ? await prompter.one("Package manager", PM_CHOICES, defaultPm) : defaultPm);
  let check: Check | undefined;
  for (;;) {
    const apps =
      given.apps ??
      (prompter ? await prompter.many("Apps (none: the base alone)", APP_CHOICES) : []);
    if (apps.length === 0) {
      if (given.provider !== undefined || given.features !== undefined) {
        throw new Error("--provider and --features need an app (--apps)");
      }
      return { apps: [], provider: null, features: [], pm };
    }
    check ??= await options.loadCheck();
    const loaded = check;
    const bare = (provider: Provider): Choices => ({ apps, provider, features: [], pm });
    const candidates = given.provider ? [given.provider] : PROVIDERS;
    const accepted = PROVIDER_CHOICES.filter(
      ({ value }) => candidates.includes(value) && refusal(loaded, bare(value)) === null,
    );
    const [first] = accepted;
    if (first === undefined) {
      const message =
        candidates.map((provider) => refusal(loaded, bare(provider))).find(Boolean) ??
        "no provider accepts these apps";
      if (!prompter || given.apps !== undefined || given.provider) {
        throw new Error(message);
      }
      prompter.warn(message);
      continue;
    }
    const provider =
      prompter && given.provider === undefined
        ? await prompter.one("Where it runs", accepted, first.value)
        : first.value;
    for (;;) {
      const features =
        given.features ?? (prompter ? await prompter.many("Features", FEATURE_CHOICES) : []);
      const choices: Choices = { apps, provider, features, pm };
      const message = refusal(loaded, choices);
      if (message === null) {
        return choices;
      }
      if (!prompter || given.features !== undefined) {
        throw new Error(message);
      }
      prompter.warn(message);
    }
  }
}
