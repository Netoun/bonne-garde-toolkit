import React from "react";

export type WelcomeTemplateProps = {
  appName: string;
  userName: string;
  ctaUrl: string;
};

export function WelcomeTemplate(props: WelcomeTemplateProps) {
  return React.createElement(
    "html",
    null,
    React.createElement(
      "body",
      null,
      React.createElement("h1", null, `Welcome to ${props.appName}`),
      React.createElement("p", null, `Hi ${props.userName}, your account is ready.`),
      React.createElement("p", null, React.createElement("a", { href: props.ctaUrl }, "Go to app")),
    ),
  );
}
