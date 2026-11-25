import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";
import { emailMessages, type EmailLocale } from "../messages";

export type ResetPasswordTemplateProps = {
  name: string;
  resetUrl: string;
  locale?: EmailLocale;
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
