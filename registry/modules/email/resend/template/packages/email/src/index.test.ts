import { expect, test } from "vite-plus/test";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding } from "{{SCOPE}}/config";
import {
  createMemoryEmailProvider,
  type EmailMessage,
  renderEmailTemplate,
  sendEmail,
  WelcomeTemplate,
} from "./index";

test("memory provider captures emails", async () => {
  const sent: EmailMessage[] = [];
  const provider = createMemoryEmailProvider(sent);

  await sendEmail(provider, {
    to: "test@example.com",
    subject: "Welcome",
    html: "<p>Hello</p>",
    text: "Hello",
  });

  expect(sent.length).toBe(1);
  expect(sent[0]?.to).toBe("test@example.com");
});

test("react-email template renders html", async () => {
  const { html } = await renderEmailTemplate(WelcomeTemplate, {
    appName: branding.displayName,
    userName: "Neto",
    ctaUrl: "https://example.com",
  });

  expect(html.includes(`Welcome to ${branding.displayName}`)).toBe(true);
  expect(html.includes("https://example.com")).toBe(true);
});
