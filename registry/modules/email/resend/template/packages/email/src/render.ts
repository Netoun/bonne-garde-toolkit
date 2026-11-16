import { render } from "@react-email/render";
import React from "react";
import type { EmailTemplateProps } from "./types";

export type EmailTemplate<P extends EmailTemplateProps = EmailTemplateProps> = (
  props: P,
) => React.ReactElement;

export async function renderEmailTemplate<P extends EmailTemplateProps>(
  template: EmailTemplate<P>,
  props: P,
): Promise<string> {
  return render(React.createElement(template, props));
}
