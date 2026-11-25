import { render } from "@react-email/components";
import { createElement, type ReactElement } from "react";
import type { EmailTemplateProps } from "./types";

export type EmailTemplate<P extends EmailTemplateProps = EmailTemplateProps> = (
  props: P,
) => ReactElement;

/** What a template renders to: the html part and the plain-text one, which carries the same links. */
export type RenderedEmail = { html: string; text: string };

export async function renderEmailTemplate<P extends EmailTemplateProps>(
  template: EmailTemplate<P>,
  props: P,
): Promise<RenderedEmail> {
  const element = createElement(template, props);
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}
