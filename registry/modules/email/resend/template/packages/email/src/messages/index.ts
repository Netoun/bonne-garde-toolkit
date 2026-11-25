import { en, type EmailMessages } from "./en";
import { fr } from "./fr";

export type { EmailMessages } from "./en";

/** The languages emails are written in: the same identity, and default, as the i18n module's. */
export const EMAIL_LOCALES = ["en", "fr"] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export const DEFAULT_EMAIL_LOCALE: EmailLocale = "en";

const MESSAGES: Record<EmailLocale, EmailMessages> = { en, fr };

/** The strings of `locale`, or of English when none is given. */
export function emailMessages(locale: EmailLocale = DEFAULT_EMAIL_LOCALE): EmailMessages {
  return MESSAGES[locale];
}
