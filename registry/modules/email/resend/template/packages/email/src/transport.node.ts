import { createResendEmailProvider } from "./providers/resend.provider";
import { createSmtpEmailProvider } from "./providers/smtp.provider";
import type { EmailProvider } from "./types";

/** What the transport can be pointed at: a test gives it a server of its own in place of Resend's. */
export type TransportOptions = { resendBaseUrl?: string };

function valueOf(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The adapter the dockerfile provider sends through, behind the package's `./transport` export: SMTP
 * when `SMTP_URL` is set, else Resend when `RESEND_API_KEY` is. With neither it throws, naming both,
 * and never falls back to memory: a project would send nothing and say so nowhere.
 */
export function createTransport(
  source: Record<string, unknown>,
  options: TransportOptions = {},
): EmailProvider {
  const url = valueOf(source, "SMTP_URL");
  if (url !== undefined) {
    return createSmtpEmailProvider({ url });
  }
  const apiKey = valueOf(source, "RESEND_API_KEY");
  if (apiKey !== undefined) {
    return createResendEmailProvider({ apiKey, baseUrl: options.resendBaseUrl });
  }
  throw new Error(
    "Missing email configuration: set SMTP_URL (an SMTP server, `smtp://mailpit:1025` with " +
      "packages/email/compose.mailpit.yaml) or RESEND_API_KEY (a key from https://resend.com/api-keys) " +
      "where the runtime reads its environment (the project's `.env`).",
  );
}
