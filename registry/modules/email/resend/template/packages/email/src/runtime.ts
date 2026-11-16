// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
import { resolveEmailEnv } from "./env";
import { createMemoryEmailProvider } from "./providers/memory.provider";
import { createResendEmailProvider } from "./providers/resend.provider";
import { outbox } from "./testing";
import type { EmailMessage, EmailProvider } from "./types";

export type RuntimeProviderOptions = {
  /** The environment record: `readRuntimeEnv` in a project. */
  readEnv: () => Promise<Record<string, unknown>>;
  /** Whether this is a test: the memory adapter stands in for Resend, and nothing reaches the network. */
  test: () => boolean;
  /** Where the memory adapter keeps what it is asked to send. */
  store?: EmailMessage[];
};

/**
 * The adapter the runtime sends through, chosen at the first email and not at import: the project
 * boots with no key, and an email asked for with none fails there, naming it. Under test it is the
 * memory adapter; anywhere else it is Resend, and a missing key is an error and never a quiet
 * fallback to memory (a production project would send nothing and say so nowhere). A failed read is
 * not remembered: the next email tries again.
 */
export function createRuntimeProvider(
  options: RuntimeProviderOptions,
): () => Promise<EmailProvider> {
  const { readEnv, test, store = outbox } = options;
  let provider: Promise<EmailProvider> | undefined;

  async function build(): Promise<EmailProvider> {
    if (test()) {
      return createMemoryEmailProvider(store);
    }
    return createResendEmailProvider({ apiKey: resolveEmailEnv(await readEnv()).RESEND_API_KEY });
  }

  return () => {
    if (provider === undefined) {
      const building = build();
      provider = building;
      building.catch(() => {
        if (provider === building) {
          provider = undefined;
        }
      });
    }
    return provider;
  };
}

/** `NODE_ENV=test`, as `bun test` sets it; read when asked, since `process` is not there at import everywhere. */
function underTest(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "test";
}

/** The adapter this project's runtime sends through. */
export const emailProvider = createRuntimeProvider({ readEnv: readRuntimeEnv, test: underTest });
