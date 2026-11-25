import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";

export type WelcomeTemplateProps = {
  appName: string;
  userName: string;
  ctaUrl: string;
};

export function WelcomeTemplate(props: WelcomeTemplateProps) {
  const title = `Welcome to ${props.appName}`;
  return (
    <EmailLayout preview={title}>
      <EmailHeading>{title}</EmailHeading>
      <EmailText>{`Hi ${props.userName}, your account is ready.`}</EmailText>
      <EmailButton href={props.ctaUrl}>Go to app</EmailButton>
    </EmailLayout>
  );
}
