import { describe, expect, test } from "bun:test";
import { createRuntimeProvider } from "./runtime";
import type { EmailMessage } from "./types";

const MESSAGE = { to: "ada@example.com", subject: "Hello", html: "<p>Hi</p>" };

/** An environment read that counts how often it is asked. */
function environment(source: Record<string, unknown>) {
  const reads = { count: 0 };
  return {
    reads,
    readEnv: async () => {
      reads.count += 1;
      return source;
    },
  };
}

describe("the adapter the runtime sends through", () => {
  test("under test it is the memory adapter: what is sent is kept, and the environment is never read", async () => {
    const store: EmailMessage[] = [];
    const env = environment({});
    const provider = createRuntimeProvider({ readEnv: env.readEnv, test: () => true, store });

    await (await provider()).send(MESSAGE);

    expect(store).toEqual([MESSAGE]);
    expect(env.reads.count).toBe(0);
  });

  test("outside test it is Resend, and nothing is read until the first email is asked for", async () => {
    const env = environment({ RESEND_API_KEY: "re_live" });
    const provider = createRuntimeProvider({ readEnv: env.readEnv, test: () => false });
    expect(env.reads.count).toBe(0);

    const first = await provider();
    const second = await provider();

    expect(first).toBe(second);
    expect(env.reads.count).toBe(1);
  });

  test("outside test a missing key fails, naming it, and never falls back to memory", async () => {
    const store: EmailMessage[] = [];
    const env = environment({});
    const provider = createRuntimeProvider({ readEnv: env.readEnv, test: () => false, store });

    await expect(provider()).rejects.toThrow(/RESEND_API_KEY/);
    expect(store).toEqual([]);
  });

  test("a failed read is not remembered: the key set afterwards is found by the next email", async () => {
    const source: Record<string, unknown> = {};
    const env = environment(source);
    const provider = createRuntimeProvider({ readEnv: env.readEnv, test: () => false });
    await expect(provider()).rejects.toThrow(/RESEND_API_KEY/);

    source.RESEND_API_KEY = "re_live";

    expect(typeof (await provider()).send).toBe("function");
    expect(env.reads.count).toBe(2);
  });
});
