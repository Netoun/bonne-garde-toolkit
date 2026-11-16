import { logger as apiLogger } from "{{SCOPE}}/api/lib/logger";
import type { AuthLogger } from "./auth.config";

/** One message auth asks an email module to deliver. `url` is the page of the front-end the link opens. */
export type AuthEmail = { userId: string; to: string; name: string; url: string };

/** The seam between auth and whatever delivers its emails. Auth owns the interface and nothing past it. */
export interface AuthMailer {
  sendVerificationEmail(email: AuthEmail): Promise<void>;
  sendPasswordReset(email: AuthEmail): Promise<void>;
}

/**
 * The mailer for a project with no email module: it sends nothing and says so. It never logs `url`:
 * the link carries a one-time token, and a log line is readable by more people than the inbox.
 */
export function unconfiguredMailer(logger: Pick<AuthLogger, "warn">): AuthMailer {
  return {
    async sendVerificationEmail({ userId }) {
      logger.warn("No email module is installed: the verification email was not sent", {
        scope: "auth",
        event: "email_not_sent",
        kind: "verification",
        userId,
      });
    },
    async sendPasswordReset({ userId }) {
      logger.warn("No email module is installed: the password reset email was not sent", {
        scope: "auth",
        event: "email_not_sent",
        kind: "password_reset",
        userId,
      });
    },
  };
}

/**
 * The mailer auth runs with, and the one place an `email` module wires itself in: it replaces this
 * value with an adapter that delivers an `AuthEmail` through its own package (the intention that
 * module ships, spec 065). `auth.module.ts` reads it and nothing else does.
 */
export const mailer: AuthMailer = unconfiguredMailer(apiLogger);
