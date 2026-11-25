import { emailMessages, type EmailLocale } from "./messages";
import { renderEmailTemplate } from "./render";
import { emailProvider } from "./runtime";
import { sendEmail } from "./send";
import { InvitationEmail } from "./templates/invitation.template";
import { ResetPasswordEmail } from "./templates/reset-password.template";
import { VerifyEmailEmail } from "./templates/verify-email.template";
import type { EmailProvider } from "./types";

/**
 * What auth hands a mailer for one message: the recipient, the name to greet and the page of the
 * front-end the link opens, and the language to write it in (English when absent: auth passes none yet). It is the shape of auth's `AuthEmail` without the `userId` that this
 * package has no use for, so the two stay compatible without this package importing auth's.
 */
export type AuthEmailMessage = { to: string; name: string; url: string; locale?: EmailLocale };

/**
 * What auth hands a mailer for one organization invitation: the invitee, who invited them, the
 * organization's name and the page of the front-end that accepts it.
 */
export type AuthInvitationMessage = {
  to: string;
  inviterName: string;
  organizationName: string;
  url: string;
  locale?: EmailLocale;
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
    async sendVerificationEmail({ to, name, url, locale }) {
      const { html, text } = await renderEmailTemplate(VerifyEmailEmail, {
        name,
        verificationUrl: url,
        locale,
      });
      await sendEmail(await resolveProvider(), {
        to,
        subject: emailMessages(locale).verifyEmail.subject,
        html,
        text,
      });
    },
    async sendPasswordReset({ to, name, url, locale }) {
      const { html, text } = await renderEmailTemplate(ResetPasswordEmail, {
        name,
        resetUrl: url,
        locale,
      });
      await sendEmail(await resolveProvider(), {
        to,
        subject: emailMessages(locale).resetPassword.subject,
        html,
        text,
      });
    },
    async sendInvitation({ to, inviterName, organizationName, url, locale }) {
      const { html, text } = await renderEmailTemplate(InvitationEmail, {
        inviterName,
        organizationName,
        acceptUrl: url,
        locale,
      });
      await sendEmail(await resolveProvider(), {
        to,
        subject: emailMessages(locale).invitation.subject(organizationName),
        html,
        text,
      });
    },
  };
}

/** The mailer an auth module runs with once it is wired to this package. */
export const emailMailer: AuthMailer = createAuthMailer(emailProvider);
