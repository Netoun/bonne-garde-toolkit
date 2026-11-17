import { describe, expect, test } from "bun:test";
import { cliRunner, PROJECT_RUNNER, runnerFor } from "./cli-runner";

describe("runnerFor", () => {
  test.each([
    ["bun/1.4.4 npm/? node/v26.3.0 darwin arm64", "bunx bonne-garde"],
    ["pnpm/9.12.0 npm/? node/v22.12.0 linux x64", "pnpm dlx bonne-garde"],
    ["yarn/4.5.0 npm/? node/v22.12.0 linux x64", "yarn dlx bonne-garde"],
    ["npm/10.9.0 node/v22.12.0 linux x64 workspaces/false", "npx bonne-garde"],
  ])("%s runs it as %s", (userAgent, runner) => {
    expect(runnerFor(userAgent)).toBe(runner);
  });

  test.each([undefined, "", "deno/2.0.0 npm/? node/v22.12.0 linux x64", "bunx", "pnpmish/1"])(
    "no user agent, or one that names no known package manager (%p), runs it as npx",
    (userAgent) => {
      expect(runnerFor(userAgent)).toBe("npx bonne-garde");
    },
  );
});

test("a file written into a project names bunx, whoever ran the CLI", () => {
  expect(PROJECT_RUNNER).toBe("bunx bonne-garde");
});

describe("cliRunner", () => {
  test("reads the user agent of the package manager that ran this process", () => {
    const before = process.env.npm_config_user_agent;
    try {
      process.env.npm_config_user_agent = "pnpm/9.12.0 npm/? node/v22.12.0 linux x64";
      expect(cliRunner()).toBe("pnpm dlx bonne-garde");
      delete process.env.npm_config_user_agent;
      expect(cliRunner()).toBe("npx bonne-garde");
    } finally {
      if (before === undefined) {
        delete process.env.npm_config_user_agent;
      } else {
        process.env.npm_config_user_agent = before;
      }
    }
  });
});
