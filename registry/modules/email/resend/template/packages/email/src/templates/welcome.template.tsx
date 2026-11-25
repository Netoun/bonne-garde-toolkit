import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";
import { emailMessages, type EmailLocale } from "../messages";

export type WelcomeTemplateProps = {
  appName: string;
  userName: string;
  ctaUrl: string;
  locale?: EmailLocale;
};

/** Sample props for the preview script (`preview.ts`). */
export const welcomePreviewProps: WelcomeTemplateProps = {
  appName: "Acme",
  userName: "Ada",
  ctaUrl: "https://app.example.com/",
};

export function WelcomeTemplate(props: WelcomeTemplateProps) {
  const t = emailMessages(props.locale).welcome;
  const title = t.heading(props.appName);
  return (
    <EmailLayout preview={title} locale={props.locale}>
      <EmailHeading>{title}</EmailHeading>
      <EmailText>{t.body(props.userName)}</EmailText>
      <EmailButton href={props.ctaUrl}>{t.button}</EmailButton>
    </EmailLayout>
  );
}
