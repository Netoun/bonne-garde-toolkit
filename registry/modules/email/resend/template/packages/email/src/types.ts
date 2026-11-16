export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
};

export type EmailProvider = {
  send(message: EmailMessage): Promise<void>;
};

export type EmailTemplateProps = Record<string, unknown>;
