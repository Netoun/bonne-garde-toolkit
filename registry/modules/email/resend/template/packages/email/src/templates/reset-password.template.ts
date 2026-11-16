import React from "react";

export type ResetPasswordTemplateProps = {
  name: string;
  resetUrl: string;
};

export function ResetPasswordEmail(props: ResetPasswordTemplateProps) {
  return React.createElement(
    "html",
    null,
    React.createElement(
      "body",
      null,
      React.createElement("h1", null, "Reset your password"),
      React.createElement("p", null, `Hi ${props.name},`),
      React.createElement(
        "p",
        null,
        "You requested a password reset. Click the link below to reset your password:",
      ),
      React.createElement(
        "p",
        null,
        React.createElement("a", { href: props.resetUrl }, "Reset password"),
      ),
    ),
  );
}
