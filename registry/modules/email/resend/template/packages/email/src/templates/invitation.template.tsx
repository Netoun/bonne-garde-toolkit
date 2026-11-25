import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";

export type InvitationTemplateProps = {
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
};

export function InvitationEmail(props: InvitationTemplateProps) {
  const title = `${props.inviterName} invited you to join ${props.organizationName}`;
  return (
    <EmailLayout preview={title}>
      <EmailHeading>{title}</EmailHeading>
      <EmailText>Click the link below to accept the invitation. It expires in 7 days.</EmailText>
      <EmailButton href={props.acceptUrl}>Accept invitation</EmailButton>
    </EmailLayout>
  );
}
