import { describe, expect, test } from "bun:test";
import { recapLines, shouldRecap } from "./create-command";

describe("recapLines", () => {
  test("names the directory, the package manager, each app, the provider and each feature", () => {
    const text = recapLines("my-app", {
      apps: ["api", "spa"],
      provider: "cloudflare",
      features: ["db", "auth"],
      pm: "pnpm",
    }).join("\n");
    for (const part of ["my-app", "pnpm", "api", "spa", "cloudflare", "db", "auth"]) {
      expect(text).toContain(part);
    }
  });

  test("says none for a project of the base alone", () => {
    const lines = recapLines("base-only", { apps: [], provider: null, features: [], pm: "bun" });
    expect(lines.join("\n")).toContain("none, the base alone");
    expect(lines.join("\n")).toContain("base-only");
  });

  test("says none for a project with apps and no feature", () => {
    const lines = recapLines("my-app", {
      apps: ["spa"],
      provider: "dockerfile",
      features: [],
      pm: "bun",
    });
    expect(lines.some((line) => line.includes("none"))).toBe(true);
  });
});

describe("shouldRecap", () => {
  const all = { pm: "bun", apps: ["spa"], provider: "cloudflare", features: [] } as const;

  test("is false without a prompter (--yes, or no TTY on stdin)", () => {
    expect(shouldRecap({ prompted: false, nameGiven: false, given: {} })).toBe(false);
  });

  test("is false when flags gave every axis and the directory", () => {
    expect(shouldRecap({ prompted: true, nameGiven: true, given: all })).toBe(false);
  });

  test("is false when no app was given by flag, so provider and features are not asked", () => {
    expect(shouldRecap({ prompted: true, nameGiven: true, given: { pm: "bun", apps: [] } })).toBe(
      false,
    );
  });

  test("is true as soon as the directory or one axis was asked", () => {
    expect(shouldRecap({ prompted: true, nameGiven: false, given: all })).toBe(true);
    expect(shouldRecap({ prompted: true, nameGiven: true, given: { ...all, pm: undefined } })).toBe(
      true,
    );
    expect(
      shouldRecap({ prompted: true, nameGiven: true, given: { ...all, provider: undefined } }),
    ).toBe(true);
    expect(
      shouldRecap({ prompted: true, nameGiven: true, given: { ...all, features: undefined } }),
    ).toBe(true);
    expect(shouldRecap({ prompted: true, nameGiven: true, given: {} })).toBe(true);
  });
});
