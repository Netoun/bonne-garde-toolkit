import { resolveEmailEnv } from "./env";
import { createResendEmailProvider } from "./providers/resend.provider";
import type { EmailProvider } from "./types";

/** What the transport can be pointed at: a test gives it a server of its own in place of Resend's. */
export type TransportOptions = { resendBaseUrl?: string };

/**
 * The adapter this variant sends through, behind the package's `./transport` export: Resend, with the
 * key from the environment record. A missing key throws, naming it.
 */
export function createTransport(
  source: Record<string, unknown>,
  options: TransportOptions = {},
): EmailProvider {
  return createResendEmailProvider({
    apiKey: resolveEmailEnv(source).RESEND_API_KEY,
    baseUrl: options.resendBaseUrl,
  });
}
