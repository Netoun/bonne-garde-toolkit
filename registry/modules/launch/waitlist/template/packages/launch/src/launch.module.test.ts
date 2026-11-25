import { afterAll, describe, expect, it } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { launchModule, resolveRuntimeLaunch } from "./launch.module";

const dataDir = await mkdtemp(join(tmpdir(), "launch-module-"));

afterAll(() => rm(dataDir, { recursive: true, force: true }));

/**
 * Runs `body` with some variables of the process set (or unset, for `undefined`), then puts them back.
 * Under Bun `readRuntimeEnv()` is the process environment.
 */
async function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((name) => [name, process.env[name]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  };
  set(vars);
  try {
    return await body();
  } finally {
    set(before);
  }
}

// What `apps/api` mounts, over the runtime this test runs in: the one of the provider, on a temp DATA_DIR.
describe("resolveRuntimeLaunch", () => {
  it("reads the stage and the limit from the environment, and the address header of the provider", async () => {
    const context = await withEnv(
      { DATA_DIR: dataDir, LAUNCH_STAGE: "launched", LAUNCH_WAITLIST_MAX_PER_HOUR: "3" },
      resolveRuntimeLaunch,
    );

    expect(context.env).toEqual({ LAUNCH_STAGE: "launched", LAUNCH_WAITLIST_MAX_PER_HOUR: 3 });
    expect(context.clientIpHeaders).toContain("x-client-ip");
  });

  it("throws when the stage is missing or invalid", async () => {
    await withEnv({ DATA_DIR: dataDir, LAUNCH_STAGE: undefined }, async () => {
      await expect(resolveRuntimeLaunch()).rejects.toThrow(/LAUNCH_STAGE/);
    });
    await withEnv({ DATA_DIR: dataDir, LAUNCH_STAGE: "soon" }, async () => {
      await expect(resolveRuntimeLaunch()).rejects.toThrow(/LAUNCH_STAGE/);
    });
  });
});

describe("launchModule", () => {
  it("is mounted without the environment: nothing is read at import time, only when a request comes", async () => {
    const app = new Elysia().use(launchModule).get("/health", () => ({ status: "ok" }));

    await withEnv({ DATA_DIR: dataDir, LAUNCH_STAGE: undefined }, async () => {
      expect((await app.handle(new Request("http://api.test/health"))).status).toBe(200);
      expect((await app.handle(new Request("http://api.test/launch"))).status).toBe(500);
    });
    await withEnv({ DATA_DIR: dataDir, LAUNCH_STAGE: "waiting" }, async () => {
      const answered = await app.handle(new Request("http://api.test/launch"));
      expect(await answered.json()).toEqual({ stage: "waiting" });
    });
  });
});
