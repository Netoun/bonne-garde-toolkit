/**
 * Spec 040: what `create` asks, and the registry names each answer stands for. Which answers go
 * together is the registry's to say: a set is checked as `bg add` would plan it (`Check`), so no
 * compatibility rule lives here.
 */
import type { PackageManager } from "./package-manager";

const PM_LABELS = {
  bun: "Bun installs the project and runs its scripts",
  pnpm: "pnpm installs the project, Node runs its scripts",
} as const satisfies Record<PackageManager, string>;

const APP_LABELS = {
  api: "the Elysia API",
  spa: "a React Router SPA",
  ssr: "a React Router SSR app",
  static: "a static site",
} as const;

const PROVIDER_LABELS = {
  cloudflare: "Cloudflare Workers and Pages",
  dockerfile: "one Node container",
} as const;

const FEATURE_LABELS = {
  db: "a D1 database with Drizzle",
  auth: "Better Auth sessions and organizations, and the SPA's sign-in pages",
  storage: "media uploads on R2",
  email: "transactional email with Resend",
  deploy: "a GitHub Actions deploy",
  backoffice: "the SPA's signed-in backoffice",
} as const;

export type App = keyof typeof APP_LABELS;
export type Provider = keyof typeof PROVIDER_LABELS;
export type Feature = keyof typeof FEATURE_LABELS;

export const APPS = Object.keys(APP_LABELS) as App[];
export const PROVIDERS = Object.keys(PROVIDER_LABELS) as Provider[];
export const FEATURES = Object.keys(FEATURE_LABELS) as Feature[];

export type Choices = {
  apps: readonly App[];
  provider: Provider | null;
  features: readonly Feature[];
  pm: PackageManager;
};

/** Every module an answer can name, in the order `bg add` is given them. */
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
  db: ["db/d1", "orm/drizzle"],
  auth: ["auth/better-auth"],
  storage: ["storage/r2"],
  email: ["email/resend"],
  deploy: ["deploy/cloudflare-actions"],
  backoffice: [],
};

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
    "dev/portless",
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

/** Throws the planner's message when `bg add` would refuse these names in an empty project. */
export type Check = (names: string[]) => void;
/** One question on the terminal; `null` at the end of input. */
export type Ask = (question: string) => Promise<string | null>;

function refusal(check: Check, choices: Choices): string | null {
  const { modules, items } = namesFor(choices);
  try {
    check([...modules, ...items]);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function menu(labels: Record<string, string>, names: readonly string[]): string {
  return names.map((name, index) => `  ${index + 1}. ${name} — ${labels[name]}`).join("\n");
}

/** Asks a list by numbers or names until every token names one; Enter, or the end of input, is none. */
async function askList<T extends string>(
  ask: Ask,
  say: (message: string) => void,
  axis: string,
  title: string,
  labels: Record<T, string>,
): Promise<T[]> {
  const names = Object.keys(labels) as T[];
  for (;;) {
    const answer =
      (
        await ask(`${title}:\n${menu(labels, names)}\nNumbers or names, Enter for none: `)
      )?.trim() ?? "";
    const chosen: T[] = [];
    const unknown: string[] = [];
    for (const token of answer.split(/[\s,]+/).filter(Boolean)) {
      const name = /^\d+$/.test(token) ? names[Number(token) - 1] : names.find((n) => n === token);
      if (name === undefined) {
        unknown.push(token);
      } else if (!chosen.includes(name)) {
        chosen.push(name);
      }
    }
    if (unknown.length === 0) {
      return chosen;
    }
    say(`No ${axis} ${unknown.join(", ")}.`);
  }
}

/** Asks one of `names` by number or name; Enter, or the end of input, takes the first. */
async function askOne<T extends string>(
  ask: Ask,
  say: (message: string) => void,
  title: string,
  labels: Record<T, string>,
  names: readonly T[],
): Promise<T> {
  const [first] = names;
  if (first === undefined) {
    throw new Error(`no ${title.toLowerCase()} to ask among`);
  }
  for (;;) {
    const answer =
      (await ask(`${title}:\n${menu(labels, names)}\nNumber or name [${first}]: `))?.trim() ?? "";
    if (answer === "") {
      return first;
    }
    const chosen = /^\d+$/.test(answer)
      ? names[Number(answer) - 1]
      : names.find((n) => n === answer);
    if (chosen !== undefined) {
      return chosen;
    }
    say(`No ${title.toLowerCase()} ${answer}.`);
  }
}

/**
 * 040's resolution: an axis a flag gave is never asked; with no `ask` (`--yes`, or no TTY) a missing
 * axis takes its default and a refused set fails; with one, a refused set is said and its axis asked
 * again. The package manager comes first, its default the one `create` was started from
 * (`defaultPm`). The registry's check is loaded only once an app is chosen.
 */
export async function resolveChoices(options: {
  given: Partial<Choices>;
  ask: Ask | null;
  defaultPm: PackageManager;
  loadCheck: () => Promise<Check>;
  say: (message: string) => void;
}): Promise<Choices> {
  const { given, ask, defaultPm, say } = options;
  const pm =
    given.pm ??
    (ask
      ? await askOne(ask, say, "Package manager", PM_LABELS, [
          defaultPm,
          ...Object.keys(PM_LABELS).filter((name): name is PackageManager => name !== defaultPm),
        ])
      : defaultPm);
  let check: Check | undefined;
  for (;;) {
    const apps = given.apps ?? (ask ? await askList(ask, say, "app", "Apps", APP_LABELS) : []);
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
    const providers = candidates.filter((provider) => refusal(loaded, bare(provider)) === null);
    const [firstProvider] = providers;
    if (firstProvider === undefined) {
      const message =
        candidates.map((provider) => refusal(loaded, bare(provider))).find(Boolean) ??
        "no provider accepts these apps";
      if (!ask || given.apps !== undefined || given.provider) {
        throw new Error(message);
      }
      say(message);
      continue;
    }
    const provider =
      ask && given.provider === undefined
        ? await askOne(ask, say, "Provider", PROVIDER_LABELS, providers)
        : firstProvider;
    for (;;) {
      const features =
        given.features ??
        (ask ? await askList(ask, say, "feature", "Features", FEATURE_LABELS) : []);
      const choices: Choices = { apps, provider, features, pm };
      const message = refusal(loaded, choices);
      if (message === null) {
        return choices;
      }
      if (!ask || given.features !== undefined) {
        throw new Error(message);
      }
      say(message);
    }
  }
}
