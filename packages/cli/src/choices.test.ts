import { describe, expect, test } from "bun:test";
import {
  type Check,
  type Choices,
  namesFor,
  parseFlagList,
  type Prompter,
  resolveChoices,
} from "./choices";

const FULL_CLOUDFLARE: Choices = {
  apps: ["api", "spa", "ssr", "static"],
  provider: "cloudflare",
  features: ["db", "auth", "storage", "email", "deploy", "backoffice", "portless"],
  pm: "bun",
};

describe("namesFor (040: the one table the CLI holds)", () => {
  test("no app names the package manager alone", () => {
    expect(namesFor({ apps: [], provider: null, features: [], pm: "pnpm" })).toEqual({
      modules: ["pm/pnpm"],
      items: [],
    });
  });

  test("every answer, in the order bg add is given them", () => {
    expect(namesFor(FULL_CLOUDFLARE)).toEqual({
      modules: [
        "pm/bun",
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
    });
  });

  test("the ui host comes with a front, not with the api alone", () => {
    expect(
      namesFor({ apps: ["api"], provider: "dockerfile", features: [], pm: "bun" }).modules,
    ).toEqual([
      "pm/bun",
      "provider/dockerfile",
      "tooling/vite-plus",
      "config/branding",
      "api/elysia",
    ]);
    expect(
      namesFor({ apps: ["ssr"], provider: "cloudflare", features: [], pm: "bun" }).modules,
    ).toContain("ui/shadcn");
  });

  test("portless is a tool a project opts into: dev/portless only with the portless feature", () => {
    const spa = { apps: ["spa"], provider: "cloudflare", pm: "bun" } as const;
    expect(namesFor({ ...spa, features: [] }).modules).not.toContain("dev/portless");
    expect(namesFor({ ...spa, features: ["portless"] }).modules).toContain("dev/portless");
  });

  test("auth brings the sign-in pages only with the spa", () => {
    expect(
      namesFor({ apps: ["api"], provider: "cloudflare", features: ["db", "auth"], pm: "bun" })
        .items,
    ).toEqual([]);
  });
});

describe("parseFlagList", () => {
  test("takes a comma-separated list, each value once", () => {
    expect(parseFlagList("--apps", "api,spa,api", ["api", "spa", "ssr"])).toEqual(["api", "spa"]);
  });

  test("refuses a value it does not know, naming the flag and the values", () => {
    expect(() => parseFlagList("--apps", "api,web", ["api", "spa"])).toThrow(
      "--apps: unknown value web: pass one of api, spa",
    );
  });
});

/** A registry in miniature: fronts need the api, ssr has no dockerfile variant, the container is Bun's. */
const check: Check = (names) => {
  if (names.includes("provider/dockerfile") && names.includes("pm/pnpm")) {
    throw new Error("provider/dockerfile accepts only bun for pm");
  }
  if (names.some((name) => name.startsWith("web/")) && !names.includes("api/elysia")) {
    throw new Error("web/spa needs a module in category api (elysia) and none is installed");
  }
  if (names.includes("web/ssr") && names.includes("provider/dockerfile")) {
    throw new Error("no variant of web/ssr matches the installed peers");
  }
  if (names.includes("auth/better-auth") && !names.includes("db/d1")) {
    throw new Error("auth/better-auth needs a module in category db (d1) and none is installed");
  }
};

/**
 * Answers in order: a value for `one` ("" takes the initial one), a list for `many`. What was asked and
 * offered, and what was said, are kept.
 */
function scripted(...answers: (string | string[])[]) {
  const asked: { message: string; offered: string[] }[] = [];
  const said: string[] = [];
  const next = (message: string) => {
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error(`asked "${message}", which the script does not answer`);
    }
    return answer;
  };
  const prompter: Prompter = {
    async one(message, choices, initial) {
      asked.push({ message, offered: choices.map(({ value }) => value) });
      const answer = next(message);
      const chosen = answer === "" ? initial : choices.find(({ value }) => value === answer)?.value;
      if (chosen === undefined) {
        throw new Error(`${String(answer)} is not offered for "${message}"`);
      }
      return chosen;
    },
    async many(message, choices) {
      asked.push({ message, offered: choices.map(({ value }) => value) });
      const answer = next(message);
      return choices
        .filter(({ value }) => Array.isArray(answer) && answer.includes(value))
        .map(({ value }) => value);
    },
    warn: (message) => said.push(message),
  };
  return { asked, said, prompter };
}

function never(): never {
  throw new Error("loaded the registry for a project with no app");
}

describe("resolveChoices without a prompt (--yes, or no TTY)", () => {
  test("is the base alone, without loading the registry", async () => {
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        prompter: null,
        loadCheck: never,
      }),
    ).toEqual({
      apps: [],
      provider: null,
      features: [],
      pm: "bun",
    });
  });

  test("takes the first provider the check accepts, and no feature", async () => {
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api", "ssr"] },
        prompter: null,
        loadCheck: async () => check,
      }),
    ).toEqual({ apps: ["api", "ssr"], provider: "cloudflare", features: [], pm: "bun" });
  });

  test("fails with the check's message on a refused set", async () => {
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { apps: ["spa"] },
        prompter: null,
        loadCheck: async () => check,
      }),
    ).rejects.toThrow("web/spa needs a module in category api");
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api", "ssr"], provider: "dockerfile" },
        prompter: null,
        loadCheck: async () => check,
      }),
    ).rejects.toThrow("no variant of web/ssr");
  });

  test("refuses a provider or features with no app", async () => {
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { features: ["email"] },
        prompter: null,
        loadCheck: never,
      }),
    ).rejects.toThrow("--provider and --features need an app (--apps)");
  });
});

describe("resolveChoices with a prompt", () => {
  test("asks only what no flag gave", async () => {
    const io = scripted(["auth", "db"]);
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api"], provider: "cloudflare", pm: "bun" },
        prompter: io.prompter,
        loadCheck: async () => check,
      }),
    ).toEqual({ apps: ["api"], provider: "cloudflare", features: ["db", "auth"], pm: "bun" });
    expect(io.asked.map(({ message }) => message)).toEqual(["Features"]);
  });

  test("asks the package manager first, the one create was started from offered first", async () => {
    const io = scripted("", []);
    expect(
      await resolveChoices({
        defaultPm: "pnpm",
        given: {},
        prompter: io.prompter,
        loadCheck: never,
      }),
    ).toEqual({ apps: [], provider: null, features: [], pm: "pnpm" });
    expect(io.asked[0]).toEqual({ message: "Package manager", offered: ["bun", "pnpm"] });
  });

  test("offers only the providers the check accepts with the apps, the first by default", async () => {
    const io = scripted("", ["api", "ssr"], "", []);
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        prompter: io.prompter,
        loadCheck: async () => check,
      }),
    ).toEqual({ apps: ["api", "ssr"], provider: "cloudflare", features: [], pm: "bun" });
    expect(io.asked[2]).toEqual({ message: "Where it runs", offered: ["cloudflare"] });
  });

  test("under pnpm, offers only the providers the registry accepts with it", async () => {
    const io = scripted("pnpm", ["api"], "", []);
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        prompter: io.prompter,
        loadCheck: async () => check,
      }),
    ).toEqual({ apps: ["api"], provider: "cloudflare", features: [], pm: "pnpm" });
    expect(io.asked[2]?.offered).toEqual(["cloudflare"]);
  });

  test("no app is the base alone, and the registry is not read", async () => {
    const io = scripted("", []);
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        prompter: io.prompter,
        loadCheck: never,
      }),
    ).toEqual({ apps: [], provider: null, features: [], pm: "bun" });
  });

  test("asks the features again after a set the check refuses, saying why", async () => {
    const io = scripted("", ["auth"], ["db", "auth"]);
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api"], provider: "cloudflare" },
        prompter: io.prompter,
        loadCheck: async () => check,
      }),
    ).toEqual({ apps: ["api"], provider: "cloudflare", features: ["db", "auth"], pm: "bun" });
    expect(io.said).toEqual([
      "auth/better-auth needs a module in category db (d1) and none is installed",
    ]);
  });

  test("asks the apps again when no provider accepts them", async () => {
    const io = scripted("", ["spa"], ["api", "spa"], "", []);
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        prompter: io.prompter,
        loadCheck: async () => check,
      }),
    ).toEqual({ apps: ["api", "spa"], provider: "cloudflare", features: [], pm: "bun" });
    expect(io.said[0]).toContain("web/spa needs a module in category api");
  });
});

describe("resolveChoices and --pm", () => {
  test("takes the flag over the default, and asks nothing of it", async () => {
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: { pm: "pnpm" },
        prompter: null,
        loadCheck: never,
      }),
    ).toEqual({ apps: [], provider: null, features: [], pm: "pnpm" });
  });

  test("fails with the registry's message on a provider the package manager cannot run", async () => {
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api"], provider: "dockerfile", pm: "pnpm" },
        prompter: null,
        loadCheck: async () => check,
      }),
    ).rejects.toThrow("provider/dockerfile accepts only bun for pm");
  });
});
