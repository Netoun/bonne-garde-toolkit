import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";
import { emailMessages, type EmailLocale } from "../messages";

export type ResetPasswordTemplateProps = {
  name: string;
  resetUrl: string;
  locale?: EmailLocale;
};

/** Sample props for the preview script (`preview.ts`). */
export const resetPasswordPreviewProps: ResetPasswordTemplateProps = {
  name: "Ada",
  resetUrl: "https://app.example.com/auth/reset-password?token=sample",
};

export function ResetPasswordEmail(props: ResetPasswordTemplateProps) {
  const t = emailMessages(props.locale).resetPassword;
  return (
    <EmailLayout preview={t.heading} locale={props.locale}>
      <EmailHeading>{t.heading}</EmailHeading>
      <EmailText>{t.greeting(props.name)}</EmailText>
      <EmailText>{t.body}</EmailText>
      <EmailButton href={props.resetUrl}>{t.button}</EmailButton>
    </EmailLayout>
  );
}
