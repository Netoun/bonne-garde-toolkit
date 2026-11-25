import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";

export type VerifyEmailTemplateProps = {
  name: string;
  verificationUrl: string;
};

export function VerifyEmailEmail(props: VerifyEmailTemplateProps) {
  return (
    <EmailLayout preview="Verify your email address">
      <EmailHeading>Verify your email address</EmailHeading>
      <EmailText>{`Hi ${props.name},`}</EmailText>
      <EmailText>Please click the link below to verify your email address:</EmailText>
      <EmailButton href={props.verificationUrl}>Verify email</EmailButton>
    </EmailLayout>
  );
}
