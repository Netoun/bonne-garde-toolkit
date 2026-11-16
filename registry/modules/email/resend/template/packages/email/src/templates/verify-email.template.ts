import React from "react";

export type VerifyEmailTemplateProps = {
  name: string;
  verificationUrl: string;
};

export function VerifyEmailEmail(props: VerifyEmailTemplateProps) {
  return React.createElement(
    "html",
    null,
    React.createElement(
      "body",
      null,
      React.createElement("h1", null, "Verify your email address"),
      React.createElement("p", null, `Hi ${props.name},`),
      React.createElement("p", null, "Please click the link below to verify your email address:"),
      React.createElement(
        "p",
        null,
        React.createElement("a", { href: props.verificationUrl }, "Verify email"),
      ),
    ),
  );
}
