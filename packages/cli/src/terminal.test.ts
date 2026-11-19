import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadLocalRegistry } from "@bonne-garde/registry";
import { MODULE_CATEGORIES } from "@bonne-garde/schema";
import type { Choice, Prompter } from "./choices";
import { findRepoRoot } from "./paths";
import {
  addGroups,
  type AddGroup,
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

/**
 * A prompter that walks `add`'s menus: `one` answers from `menus` in order ("done" once they run
 * out), `search` from `ticks` in order. Records what was shown.
 */
function walking(menus: string[], ticks: string[][]) {
  const asked: { message: string; choices: readonly Choice<string>[]; initial: string }[] = [];
  const lists: { message: string; choices: readonly Choice<string>[] }[] = [];
  const prompter: Prompter = {
    one: (message, choices, initial) => {
      asked.push({ message, choices, initial });
      return Promise.resolve((menus.shift() ?? "done") as never);
    },
    many: () => Promise.reject(new Error("add asks through the menus")),
    search: (message, choices) => {
      lists.push({ message, choices });
      return Promise.resolve((ticks.shift() ?? []) as never);
    },
    warn: () => undefined,
  };
  return { prompter, asked, lists };
}

describe("addGroups", () => {
  test("opens with the modules (a sub-family per category, in order), then the features, then each other kind, every hint starting with its kind", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    const groups = addGroups(catalog);
    const [modules, ...rest] = groups;
    expect(modules?.value).toBe("modules");
    const categories =
      "children" in (modules ?? {}) ? (modules as { children: AddGroup[] }).children : [];
    const order = categories.map(({ value }) => MODULE_CATEGORIES.indexOf(value as never));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(rest[0]?.value).toBe("feature");
    expect(rest.map(({ label }) => label).slice(0, 2)).toEqual(["Features", expect.any(String)]);
    expect(rest.at(-1)?.value).not.toBe("feature");
    const checklists = (groups: AddGroup[]) =>
      groups.flatMap((group) => ("choices" in group ? [group] : []));
    const moduleLists = checklists(categories);
    const itemLists = checklists(rest);
    // Every module and item is in exactly one checklist, none lost or repeated.
    expect(
      [...moduleLists, ...itemLists]
        .flatMap(({ choices }) => choices.map(({ value }) => value))
        .sort(),
    ).toEqual(
      [
        ...catalog.modules.map(({ manifest }) => `${manifest.category}/${manifest.id}`),
        ...catalog.items.map(({ name }) => name),
      ].sort(),
    );
    for (const { choices } of moduleLists) {
      expect(choices.every(({ hint }) => hint.startsWith("module · "))).toBe(true);
    }
    for (const { value, choices } of itemLists) {
      expect(choices.every(({ hint }) => hint.startsWith(`${value} · `))).toBe(true);
    }
    const lists = itemLists;
    const features = lists.find(({ value }) => value === "feature");
    expect(features?.choices.map(({ value }) => value)).toContain("spa-auth");
  });

  test("offers the items alone when the source cannot list modules (a reader is set)", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    const reader = {
      label: "github:x/y@v1",
      read: () => Promise.resolve(""),
      readBytes: () => Promise.resolve(new Uint8Array()),
    };
    const groups = addGroups({ ...catalog, modules: [], reader });
    expect(groups[0]?.value).toBe("feature");
    expect(
      groups
        .flatMap((group) => ("choices" in group ? group.choices.map(({ value }) => value) : []))
        .sort(),
    ).toEqual(catalog.items.map(({ name }) => name).sort());
  });
});

describe("pickAddNames", () => {
  test("opens a family, a sub-family, filters in the checklist, and comes back to the menus until done", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    const { prompter, asked, lists } = walking(
      ["feature", "modules", "provider", "back"],
      [["spa-auth"], ["provider/cloudflare"]],
    );
    expect(await pickAddNames(catalog, prompter)).toEqual(["spa-auth", "provider/cloudflare"]);
    expect(asked.map(({ message }) => message)).toEqual([
      "What to add (pick a family)",
      "What to add (pick a family)",
      "Modules: pick a sub-family",
      "Modules: pick a sub-family",
      "What to add (pick a family)",
    ]);
    expect(asked[0]?.initial).toBe("modules");
    expect(asked[1]?.initial).toBe("done");
    expect(asked[4]?.choices.at(-1)?.label).toBe("Done (2 ticked)");
    expect(asked[2]?.choices.at(-1)?.value).toBe("back");
    expect(lists.map(({ message }) => message)).toEqual([
      "Features (type to filter)",
      "provider (type to filter)",
    ]);
  });

  test("a name ticked twice is returned once", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    const { prompter } = walking(["feature", "feature"], [["spa-auth"], ["spa-auth"]]);
    expect(await pickAddNames(catalog, prompter)).toEqual(["spa-auth"]);
  });

  test("done with nothing ticked is a cancellation: nothing is added", async () => {
    const catalog = await loadLocalRegistry(REGISTRY_JSON);
    await expect(pickAddNames(catalog, walking([], []).prompter)).rejects.toBeInstanceOf(Cancelled);
    await expect(pickAddNames(catalog, walking(["feature"], [[]]).prompter)).rejects.toBeInstanceOf(
      Cancelled,
    );
  });
});
