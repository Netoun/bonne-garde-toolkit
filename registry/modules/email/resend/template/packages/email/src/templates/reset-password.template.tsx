import { EmailButton, EmailHeading, EmailLayout, EmailText } from "../components/email-kit";

export type ResetPasswordTemplateProps = {
  name: string;
  resetUrl: string;
};

export function ResetPasswordEmail(props: ResetPasswordTemplateProps) {
  return (
    <EmailLayout preview="Reset your password">
      <EmailHeading>Reset your password</EmailHeading>
      <EmailText>{`Hi ${props.name},`}</EmailText>
      <EmailText>
        You requested a password reset. Click the link below to reset your password:
      </EmailText>
      <EmailButton href={props.resetUrl}>Reset password</EmailButton>
    </EmailLayout>
  );
}
