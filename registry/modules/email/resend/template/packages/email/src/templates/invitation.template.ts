import React from "react";

export type InvitationTemplateProps = {
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
};

export function InvitationEmail(props: InvitationTemplateProps) {
  return React.createElement(
    "html",
    null,
    React.createElement(
      "body",
      null,
      React.createElement(
        "h1",
        null,
        `${props.inviterName} invited you to join ${props.organizationName}`,
      ),
      React.createElement(
        "p",
        null,
        "Click the link below to accept the invitation. It expires in 7 days.",
      ),
      React.createElement(
        "p",
        null,
        React.createElement("a", { href: props.acceptUrl }, "Accept invitation"),
      ),
    ),
  );
}
