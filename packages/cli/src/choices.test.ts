import { describe, expect, test } from "bun:test";
import { type Choices, namesFor, parseFlagList, resolveChoices, type Check } from "./choices";

const FULL_CLOUDFLARE: Choices = {
  apps: ["api", "spa", "ssr", "static"],
  provider: "cloudflare",
  features: ["db", "auth", "storage", "email", "deploy", "backoffice"],
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
      "dev/portless",
    ]);
    expect(
      namesFor({ apps: ["ssr"], provider: "cloudflare", features: [], pm: "bun" }).modules,
    ).toContain("ui/shadcn");
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

function scripted(...answers: (string | null)[]) {
  const asked: string[] = [];
  const said: string[] = [];
  return {
    asked,
    said,
    ask: async (question: string) => {
      asked.push(question);
      return answers.shift() ?? null;
    },
    say: (message: string) => said.push(message),
  };
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
        ask: null,
        loadCheck: never,
        say: () => {},
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
        ask: null,
        loadCheck: async () => check,
        say: () => {},
      }),
    ).toEqual({ apps: ["api", "ssr"], provider: "cloudflare", features: [], pm: "bun" });
  });

  test("fails with the check's message on a refused set", async () => {
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { apps: ["spa"] },
        ask: null,
        loadCheck: async () => check,
        say: () => {},
      }),
    ).rejects.toThrow("web/spa needs a module in category api");
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api", "ssr"], provider: "dockerfile" },
        ask: null,
        loadCheck: async () => check,
        say: () => {},
      }),
    ).rejects.toThrow("no variant of web/ssr");
  });

  test("refuses a provider or features with no app", async () => {
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { features: ["email"] },
        ask: null,
        loadCheck: never,
        say: () => {},
      }),
    ).rejects.toThrow("--provider and --features need an app (--apps)");
  });
});

describe("resolveChoices with a prompt", () => {
  test("asks only what no flag gave", async () => {
    const io = scripted("auth db");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api"], provider: "cloudflare", pm: "bun" },
        ask: io.ask,
        loadCheck: async () => check,
        say: io.say,
      }),
    ).toEqual({ apps: ["api"], provider: "cloudflare", features: ["auth", "db"], pm: "bun" });
    expect(io.asked).toHaveLength(1);
    expect(io.asked[0]).toContain("Features");
  });

  test("offers only the providers the check accepts with the apps, Enter taking the first", async () => {
    const io = scripted("", "api,ssr", "", "");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        ask: io.ask,
        loadCheck: async () => check,
        say: io.say,
      }),
    ).toEqual({ apps: ["api", "ssr"], provider: "cloudflare", features: [], pm: "bun" });
    expect(io.asked[2]).toContain("cloudflare");
    expect(io.asked[2]).not.toContain("dockerfile");
  });

  test("takes answers by number or by name, Enter on the apps being the base alone", async () => {
    const byNumber = scripted("1", "1", "2", "4");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        ask: byNumber.ask,
        loadCheck: async () => check,
        say: byNumber.say,
      }),
    ).toEqual({ apps: ["api"], provider: "dockerfile", features: ["email"], pm: "bun" });

    const none = scripted("");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        ask: none.ask,
        loadCheck: never,
        say: none.say,
      }),
    ).toEqual({ apps: [], provider: null, features: [], pm: "bun" });
  });

  test("asks the features again after a set the check refuses, saying why", async () => {
    const io = scripted("", "auth", "db,auth");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api"], provider: "cloudflare" },
        ask: io.ask,
        loadCheck: async () => check,
        say: io.say,
      }),
    ).toEqual({ apps: ["api"], provider: "cloudflare", features: ["db", "auth"], pm: "bun" });
    expect(io.said).toEqual([
      "auth/better-auth needs a module in category db (d1) and none is installed",
    ]);
  });

  test("asks the apps again when no provider accepts them", async () => {
    const io = scripted("", "spa", "api,spa", "", "");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        ask: io.ask,
        loadCheck: async () => check,
        say: io.say,
      }),
    ).toEqual({ apps: ["api", "spa"], provider: "cloudflare", features: [], pm: "bun" });
    expect(io.said[0]).toContain("web/spa needs a module in category api");
  });

  test("asks again after an answer that names nothing it knows", async () => {
    const io = scripted("", "api,web", "api", "", "");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        ask: io.ask,
        loadCheck: async () => check,
        say: io.say,
      }),
    ).toEqual({ apps: ["api"], provider: "cloudflare", features: [], pm: "bun" });
    expect(io.said).toEqual(["No app web."]);
  });

  test("asks the package manager first, offering the one create was started from as the default", async () => {
    const io = scripted("", "");
    expect(
      await resolveChoices({
        defaultPm: "pnpm",
        given: {},
        ask: io.ask,
        loadCheck: never,
        say: io.say,
      }),
    ).toEqual({ apps: [], provider: null, features: [], pm: "pnpm" });
    expect(io.asked[0]).toContain("Package manager");
    expect(io.asked[0]).toContain("[pnpm]");
  });

  test("under pnpm, offers only the providers the registry accepts with it", async () => {
    const io = scripted("pnpm", "api", "", "");
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: {},
        ask: io.ask,
        loadCheck: async () => check,
        say: io.say,
      }),
    ).toEqual({ apps: ["api"], provider: "cloudflare", features: [], pm: "pnpm" });
    expect(io.asked[2]).not.toContain("dockerfile");
  });
});

describe("resolveChoices and --pm", () => {
  test("takes the flag over the default, and asks nothing of it", async () => {
    expect(
      await resolveChoices({
        defaultPm: "bun",
        given: { pm: "pnpm" },
        ask: null,
        loadCheck: never,
        say: () => {},
      }),
    ).toEqual({ apps: [], provider: null, features: [], pm: "pnpm" });
  });

  test("fails with the registry's message on a provider the package manager cannot run", async () => {
    await expect(
      resolveChoices({
        defaultPm: "bun",
        given: { apps: ["api"], provider: "dockerfile", pm: "pnpm" },
        ask: null,
        loadCheck: async () => check,
        say: () => {},
      }),
    ).rejects.toThrow("provider/dockerfile accepts only bun for pm");
  });
});
