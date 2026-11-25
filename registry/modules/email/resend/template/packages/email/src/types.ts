export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  /** The plain-text alternative: mail clients that show no html, and spam filters, read it. */
  text: string;
};

export type EmailProvider = {
  send(message: EmailMessage): Promise<void>;
};

export type EmailTemplateProps = Record<string, unknown>;
