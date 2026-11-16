import type { EmailMessage, EmailProvider } from "./types";

export async function sendEmail(provider: EmailProvider, message: EmailMessage): Promise<void> {
  await provider.send(message);
}
