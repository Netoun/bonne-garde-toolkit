import { renderEmailTemplate } from "./render";
import { emailProvider } from "./runtime";
import { sendEmail } from "./send";
import { InvitationEmail } from "./templates/invitation.template";
import { ResetPasswordEmail } from "./templates/reset-password.template";
import { VerifyEmailEmail } from "./templates/verify-email.template";
import type { EmailProvider } from "./types";

/**
 * What auth hands a mailer for one message: the recipient, the name to greet and the page of the
 * front-end the link opens. It is the shape of auth's `AuthEmail` without the `userId` that this
 * package has no use for, so the two stay compatible without this package importing auth's.
 */
export type AuthEmailMessage = { to: string; name: string; url: string };

/**
 * What auth hands a mailer for one organization invitation: the invitee, who invited them, the
 * organization's name and the page of the front-end that accepts it.
 */
export type AuthInvitationMessage = {
  to: string;
  inviterName: string;
  organizationName: string;
  url: string;
};

/** The messages auth asks for; auth's `AuthMailer` is assignable from it. */
export type AuthMailer = {
  sendVerificationEmail(email: AuthEmailMessage): Promise<void>;
  sendPasswordReset(email: AuthEmailMessage): Promise<void>;
  sendInvitation(invitation: AuthInvitationMessage): Promise<void>;
};

/**
 * Renders auth's two emails with this package's templates and sends them through the adapter
 * `resolveProvider` gives, asked for at each send so that nothing is built at import.
 */
export function createAuthMailer(resolveProvider: () => Promise<EmailProvider>): AuthMailer {
  return {
    async sendVerificationEmail({ to, name, url }) {
      const html = await renderEmailTemplate(VerifyEmailEmail, { name, verificationUrl: url });
      await sendEmail(await resolveProvider(), {
        to,
        subject: "Verify your email address",
        html,
      });
    },
    async sendPasswordReset({ to, name, url }) {
      const html = await renderEmailTemplate(ResetPasswordEmail, { name, resetUrl: url });
      await sendEmail(await resolveProvider(), { to, subject: "Reset your password", html });
    },
    async sendInvitation({ to, inviterName, organizationName, url }) {
      const html = await renderEmailTemplate(InvitationEmail, {
        inviterName,
        organizationName,
        acceptUrl: url,
      });
      await sendEmail(await resolveProvider(), {
        to,
        subject: `You're invited to join ${organizationName}`,
        html,
      });
    },
  };
}

/** The mailer an auth module runs with once it is wired to this package. */
export const emailMailer: AuthMailer = createAuthMailer(emailProvider);
