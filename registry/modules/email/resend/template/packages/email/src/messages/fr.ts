import type { EmailMessages } from "./en";

export const fr: EmailMessages = {
  footer: {
    questions: "Une question ?",
  },
  verifyEmail: {
    subject: "Vérifiez votre adresse e-mail",
    heading: "Vérifiez votre adresse e-mail",
    greeting: (name) => `Bonjour ${name},`,
    body: "Cliquez sur le lien ci-dessous pour vérifier votre adresse e-mail :",
    button: "Vérifier l'adresse e-mail",
  },
  resetPassword: {
    subject: "Réinitialisez votre mot de passe",
    heading: "Réinitialisez votre mot de passe",
    greeting: (name) => `Bonjour ${name},`,
    body: "Vous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous pour le réinitialiser :",
    button: "Réinitialiser le mot de passe",
  },
  invitation: {
    subject: (organizationName) => `Vous êtes invité à rejoindre ${organizationName}`,
    heading: (inviterName, organizationName) =>
      `${inviterName} vous invite à rejoindre ${organizationName}`,
    body: "Cliquez sur le lien ci-dessous pour accepter l'invitation. Elle expire dans 7 jours.",
    button: "Accepter l'invitation",
  },
  magicLink: {
    subject: "Votre lien de connexion",
    heading: "Connectez-vous à votre compte",
    body: "Cliquez sur le lien ci-dessous pour vous connecter. Il expire dans 5 minutes et ne sert qu'une fois. Si vous ne l'avez pas demandé, ignorez cet e-mail.",
    button: "Se connecter",
  },
  welcome: {
    heading: (appName) => `Bienvenue sur ${appName}`,
    body: (userName) => `Bonjour ${userName}, votre compte est prêt.`,
    button: "Accéder à l'application",
  },
};
