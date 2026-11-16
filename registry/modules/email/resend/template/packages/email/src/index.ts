export type { EmailMessage, EmailProvider, EmailTemplateProps } from "./types";

export { createMemoryEmailProvider } from "./providers/memory.provider";
export { createResendEmailProvider, type ResendProviderOptions } from "./providers/resend.provider";

export { renderEmailTemplate } from "./render";
export type { EmailTemplate } from "./render";

export { sendEmail } from "./send";

export { resolveEmailEnv, type EmailEnv } from "./env";
export { createRuntimeProvider, emailProvider, type RuntimeProviderOptions } from "./runtime";
export {
  createAuthMailer,
  emailMailer,
  type AuthEmailMessage,
  type AuthMailer,
} from "./auth-mailer";

export { WelcomeTemplate } from "./templates/welcome.template";
export type { WelcomeTemplateProps } from "./templates/welcome.template";
export { VerifyEmailEmail } from "./templates/verify-email.template";
export type { VerifyEmailTemplateProps } from "./templates/verify-email.template";
export { ResetPasswordEmail } from "./templates/reset-password.template";
export type { ResetPasswordTemplateProps } from "./templates/reset-password.template";
