/**
 * Spec 040: a template is a recipe, the modules and items `create` adds through the `bg add`
 * pipeline right after the base copy. Golden builds its configurations from these, so every
 * template but `empty` is installed, typechecked, tested and built before a release.
 */
export type Template = {
  name: string;
  description: string;
  /** `<category>/<id>`, in the order `bg add` is given them. */
  modules: readonly string[];
  items: readonly string[];
};

export const DEFAULT_TEMPLATE = "empty";

export const TEMPLATES: readonly Template[] = [
  {
    name: "cloudflare",
    description:
      "Elysia on Workers, D1 + Drizzle, Better Auth, R2, Resend, SPA + SSR + static fronts, GitHub Actions deploy, and the SPA's auth and backoffice pages",
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
      "deploy/cloudflare-actions",
    ],
    items: ["spa-auth", "spa-backoffice"],
  },
  {
    name: "dockerfile",
    description:
      "One Bun container serving the Elysia API and the SPA from a single origin, with Resend; no database, no auth",
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
    items: [],
  },
  {
    name: DEFAULT_TEMPLATE,
    description: "The base monorepo alone; compose it later with bg add",
    modules: [],
    items: [],
  },
];

export function findTemplate(name: string): Template {
  const template = TEMPLATES.find((candidate) => candidate.name === name);
  if (!template) {
    throw new Error(
      `unknown template ${name}: pass one of ${TEMPLATES.map((t) => t.name).join(", ")}`,
    );
  }
  return template;
}

/**
 * Asks for a template until an answer names one, by its number or its name. Enter, or the end of
 * input, takes the default: the one `--yes` takes, as spec 040 requires of every prompt.
 */
export function askTemplate(read: (question: string) => string | null): string {
  const menu = TEMPLATES.map(
    ({ name, description }, index) => `  ${index + 1}. ${name} — ${description}`,
  ).join("\n");
  let question = `Template:\n${menu}\nNumber or name [${DEFAULT_TEMPLATE}]: `;
  for (;;) {
    const answer = read(question)?.trim() ?? "";
    if (answer === "") {
      return DEFAULT_TEMPLATE;
    }
    const byNumber = /^\d+$/.test(answer) ? TEMPLATES[Number(answer) - 1] : undefined;
    const chosen = byNumber ?? TEMPLATES.find(({ name }) => name === answer);
    if (chosen) {
      return chosen.name;
    }
    question = `No template ${answer}. Number or name [${DEFAULT_TEMPLATE}]: `;
  }
}

/** Spec 040's order: `--template`, then the default under `--yes` or without a TTY, then the prompt. */
export async function resolveTemplate(options: {
  flag?: string;
  yes: boolean;
  interactive: boolean;
  ask: () => string | Promise<string>;
}): Promise<string> {
  if (options.flag !== undefined) {
    return findTemplate(options.flag).name;
  }
  if (options.yes || !options.interactive) {
    return DEFAULT_TEMPLATE;
  }
  return findTemplate(await options.ask()).name;
}
