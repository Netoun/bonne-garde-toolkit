import nodemailer from "nodemailer";
import type { EmailMessage, EmailProvider } from "../types";
import { defaultFrom } from "./resend.provider";

export type SmtpProviderOptions = {
  /** `smtp://host:port`, or `smtps://user:password@host:465`: nodemailer's connection URL. */
  url: string;
  /** `Name <address@your-domain>`; defaults to the sender the Resend adapter uses. */
  from?: string;
};

/**
 * SMTP over nodemailer: the self-hosted counterpart of Resend, for the dockerfile provider (Mailpit in
 * development, any relay in production). A message goes as the `html` and `text` it was rendered to.
 */
export function createSmtpEmailProvider(options: SmtpProviderOptions): EmailProvider {
  const { url, from = defaultFrom } = options;
  const transporter = nodemailer.createTransport(url);
  return {
    async send(message: EmailMessage) {
      await transporter.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
    },
  };
}
