// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
// The provider's transport: the package's `./transport` export points at the file of its variant.
// oxfmt-ignore
import { createTransport } from "{{SCOPE}}/email/transport";
import { createMemoryEmailProvider } from "./providers/memory.provider";
import { outbox } from "./testing";
import type { EmailMessage, EmailProvider } from "./types";

export type RuntimeProviderOptions = {
  /** The environment record: `readRuntimeEnv` in a project. */
  readEnv: () => Promise<Record<string, unknown>>;
  /** Whether this is a test: the memory adapter stands in for the transport, and nothing reaches the network. */
  test: () => boolean;
  /** Where the memory adapter keeps what it is asked to send. */
  store?: EmailMessage[];
};

/**
 * The adapter the runtime sends through, chosen at the first email and not at import: the project
 * boots with no key, and an email asked for with none fails there, naming it. Under test it is the
 * memory adapter; anywhere else it is the variant's transport (`./transport`: Resend, or SMTP on the
 * dockerfile provider), and a missing key is an error and never a quiet fallback to memory (a
 * production project would send nothing and say so nowhere). A failed read is not remembered: the
 * next email tries again.
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
    return createTransport(await readEnv());
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

/** `NODE_ENV=test`, as Vitest sets it; read when asked, since `process` is not there at import everywhere. */
function underTest(): boolean {
  return typeof process !== "undefined" && process.env.NODE_ENV === "test";
}

/** The adapter this project's runtime sends through. */
export const emailProvider = createRuntimeProvider({ readEnv: readRuntimeEnv, test: underTest });
