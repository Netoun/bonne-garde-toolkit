import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadLocalRegistry, type RegistryCatalog } from "@bonne-garde/registry";
import { MODULE_CATEGORIES } from "@bonne-garde/schema";
import type { Choice, Prompter } from "./choices";
import { findRepoRoot } from "./paths";
import {
  addChoices,
  Cancelled,
  colorEnabled,
  nextSteps,
  pickAddNames,
  runnableCheck,
} from "./terminal";

describe("runnableCheck", () => {
  test("runs each command but cd through the package manager, which finds the project's bins", () => {
    expect(runnableCheck("cd packages/email && vp run typecheck && vp run test", "pnpm")).toBe(
      "cd packages/email && pnpm exec vp run typecheck && pnpm exec vp run test",
    );
    expect(runnableCheck("tsc --project x.json; vp test x.test.ts", "bun")).toBe(
      "bunx tsc --project x.json; bunx vp test x.test.ts",
    );
  });

  test("leaves a check as it is in a project that pins no package manager", () => {
    expect(runnableCheck("vp run check", null)).toBe("vp run check");
  });
});

describe("nextSteps", () => {
  test("enters the project, hands pending intentions to an agent, then the scripts it has", () => {
    expect(
      nextSteps({
        dir: "my-app",
        pm: "pnpm",
        installed: true,
        session: { path: ".bg/add/session.md", pending: 2 },
        scripts: ["dev", "dev:portless", "test", "check"],
      }).map(({ run }) => run),
    ).toEqual([
      "cd my-app",
      "read .bg/add/session.md",
      "pnpm run dev",
      "pnpm run dev:portless",
      "pnpm run test",
    ]);
  });

  test("says to install when --no-install skipped it, and stays put in the current directory", () => {
    expect(
      nextSteps({ dir: ".", pm: "bun", installed: false, session: null, scripts: [] }).map(
        ({ run }) => run,
      ),
    ).toEqual(["bun install"]);
  });
});

describe("colorEnabled", () => {
  const tty = { isTTY: true };

  test("is on for a terminal when NO_COLOR is unset", () => {
    expect(colorEnabled(tty, {})).toBe(true);
  });

  test("is off when NO_COLOR is set, whatever FORCE_COLOR says", () => {
    expect(colorEnabled(tty, { NO_COLOR: "1" })).toBe(false);
    expect(colorEnabled(tty, { NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(false);
  });

  test("is off when the stream is not a terminal, whatever FORCE_COLOR says", () => {
    expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(false);
    expect(colorEnabled({}, { FORCE_COLOR: "1" })).toBe(false);
  });
});

const REGISTRY_JSON = join(findRepoRoot() ?? "", "registry", "registry.json");

/** A prompter that answers `search` with the values it is told to pick, and records what it was shown. */
function picking(values: string[]) {
  const shown: { message: string; choices: readonly Choice<string>[] }[] = [];
  const prompter: Prompter = {
    one: () => Promise.reject(new Error("add asks no single answer")),
    many: () => Promise.reject(new Error("add asks through the filterable list")),
    search: (message, choices) => {
      shown.push({ message, choices });
      return Promise.resolve(values as never);
    },
    warn: () => undefined,
  };
  return { prompter, shown };
}

describe("addChoices", () => {
  test("lists the modules in category order, then the features, then the other items, each hint starting with its kind", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    const choices = addChoices(catalog);
    const modules = choices.slice(0, catalog.modules.length);
    const categories = modules.map(({ value }) =>
      MODULE_CATEGORIES.indexOf(value.split("/")[0] as never),
    );
    expect(categories.every((index) => index >= 0)).toBe(true);
    expect(categories).toEqual([...categories].sort((a, b) => a - b));
    const features = catalog.items.filter(({ type }) => type === "registry:block");
    const others = catalog.items.filter(({ type }) => type !== "registry:block");
    expect(features.length).toBeGreaterThan(0);
    expect(choices.slice(modules.length).map(({ value }) => value)).toEqual(
      [...features, ...others].map(({ name }) => name),
    );
    for (const { value, label, hint } of choices) {
      expect(label).toBe(value);
      const module = catalog.modules.find(
        ({ manifest }) => `${manifest.category}/${manifest.id}` === value,
      );
      const item = catalog.items.find(({ name }) => name === value);
      if (module) {
        expect(hint).toBe(`module · ${module.manifest.description}`);
      } else if (item?.type === "registry:block") {
        expect(hint).toBe(`feature · ${item.description ?? ""}`);
      } else {
        expect(hint).toMatch(/^(ui|hook|lib|component|page|file) · /);
      }
    }
    expect(choices.find(({ value }) => value === "spa-auth")?.hint).toStartWith("feature · ");
    expect(choices.find(({ value }) => value === "provider/cloudflare")?.hint).toStartWith(
      "module · ",
    );
  });

  test("offers the items alone when the source cannot list modules (a reader is set)", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    const reader = {
      label: "github:x/y@v1",
      read: () => Promise.resolve(""),
      readBytes: () => Promise.resolve(new Uint8Array()),
    };
    const remote: RegistryCatalog = { ...catalog, modules: [], reader };
    const choices = addChoices(remote);
    expect(choices.map(({ value }) => value).sort()).toEqual(
      catalog.items.map(({ name }) => name).sort(),
    );
    expect(choices[0]?.value).toBe("spa-auth");
  });
});

describe("pickAddNames", () => {
  test("returns the names the person picked, in the order add receives them", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    const { prompter, shown } = picking(["spa-auth", "provider/cloudflare"]);
    expect(await pickAddNames(catalog, prompter)).toEqual(["spa-auth", "provider/cloudflare"]);
    expect(shown).toHaveLength(1);
    expect(shown[0]?.message).toBe("What to add (type to filter)");
    expect(shown[0]?.choices).toEqual(addChoices(catalog));
  });

  test("an empty pick is a cancellation: nothing is added", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    await expect(pickAddNames(catalog, picking([]).prompter)).rejects.toBeInstanceOf(Cancelled);
  });
});
