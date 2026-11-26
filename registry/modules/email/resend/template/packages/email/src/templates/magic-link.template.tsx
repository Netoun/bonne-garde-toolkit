import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";
import { emailMessages, type EmailLocale } from "../messages";

export type MagicLinkTemplateProps = {
  signInUrl: string;
  locale?: EmailLocale;
};

/** Sample props for the preview script (`preview.ts`). */
export const magicLinkPreviewProps: MagicLinkTemplateProps = {
  signInUrl: "https://api.example.com/api/auth/magic-link/verify?token=sample&callbackURL=%2F",
};

export function MagicLinkEmail(props: MagicLinkTemplateProps) {
  const t = emailMessages(props.locale).magicLink;
  return (
    <EmailLayout preview={t.heading} locale={props.locale}>
      <EmailHeading>{t.heading}</EmailHeading>
      <EmailText>{t.body}</EmailText>
      <EmailButton href={props.signInUrl}>{t.button}</EmailButton>
    </EmailLayout>
  );
}
