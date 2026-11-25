import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";
import { emailMessages, type EmailLocale } from "../messages";

export type InvitationTemplateProps = {
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
  locale?: EmailLocale;
};

export function InvitationEmail(props: InvitationTemplateProps) {
  const t = emailMessages(props.locale).invitation;
  const title = t.heading(props.inviterName, props.organizationName);
  return (
    <EmailLayout preview={title} locale={props.locale}>
      <EmailHeading>{title}</EmailHeading>
      <EmailText>{t.body}</EmailText>
      <EmailButton href={props.acceptUrl}>{t.button}</EmailButton>
    </EmailLayout>
  );
}
