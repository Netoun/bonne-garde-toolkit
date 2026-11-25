/**
 * The English strings of every email, and the shape every other locale is typed against: a key
 * missing from `fr.ts` is a type error. Strings with a hole are functions of what fills it.
 */
export const en = {
  footer: {
    questions: "Questions?",
  },
  verifyEmail: {
    subject: "Verify your email address",
    heading: "Verify your email address",
    greeting: (name: string) => `Hi ${name},`,
    body: "Please click the link below to verify your email address:",
    button: "Verify email",
  },
  resetPassword: {
    subject: "Reset your password",
    heading: "Reset your password",
    greeting: (name: string) => `Hi ${name},`,
    body: "You requested a password reset. Click the link below to reset your password:",
    button: "Reset password",
  },
  invitation: {
    subject: (organizationName: string) => `You're invited to join ${organizationName}`,
    heading: (inviterName: string, organizationName: string) =>
      `${inviterName} invited you to join ${organizationName}`,
    body: "Click the link below to accept the invitation. It expires in 7 days.",
    button: "Accept invitation",
  },
  welcome: {
    heading: (appName: string) => `Welcome to ${appName}`,
    body: (userName: string) => `Hi ${userName}, your account is ready.`,
    button: "Go to app",
  },
};

export type EmailMessages = typeof en;
