import { describe, expect, test } from "bun:test";
import { nextSteps, runnableCheck } from "./terminal";

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
