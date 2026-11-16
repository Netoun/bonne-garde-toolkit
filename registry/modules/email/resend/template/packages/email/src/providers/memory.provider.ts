import type { EmailMessage, EmailProvider } from "../types";

export function createMemoryEmailProvider(store: EmailMessage[] = []): EmailProvider {
  return {
    async send(message: EmailMessage) {
      store.push(message);
    },
  };
}
