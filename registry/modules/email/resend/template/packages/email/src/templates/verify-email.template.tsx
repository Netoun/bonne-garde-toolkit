import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";
import { emailMessages, type EmailLocale } from "../messages";

export type VerifyEmailTemplateProps = {
  name: string;
  verificationUrl: string;
  locale?: EmailLocale;
};

/** Sample props for the preview script (`preview.ts`). */
export const verifyEmailPreviewProps: VerifyEmailTemplateProps = {
  name: "Ada",
  verificationUrl: "https://app.example.com/auth/verify-email?token=sample",
};

export function VerifyEmailEmail(props: VerifyEmailTemplateProps) {
  const t = emailMessages(props.locale).verifyEmail;
  return (
    <EmailLayout preview={t.heading} locale={props.locale}>
      <EmailHeading>{t.heading}</EmailHeading>
      <EmailText>{t.greeting(props.name)}</EmailText>
      <EmailText>{t.body}</EmailText>
      <EmailButton href={props.verificationUrl}>{t.button}</EmailButton>
    </EmailLayout>
  );
}
