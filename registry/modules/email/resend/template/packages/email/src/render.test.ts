import { describe, expect, test } from "vite-plus/test";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding } from "{{SCOPE}}/config";
import { renderEmailTemplate } from "./render";
import { InvitationEmail } from "./templates/invitation.template";
import { ResetPasswordEmail } from "./templates/reset-password.template";
import { VerifyEmailEmail } from "./templates/verify-email.template";
import { WelcomeTemplate } from "./templates/welcome.template";

const URL_WITH_TOKEN = "https://app.test/auth/verify-email?token=one-time-token";
const ANY_TAG = /<\/?[a-z!][^>]*>/i;

describe("renderEmailTemplate", () => {
  test("gives the verification email as html in the brand's theme and as text with the link and no tag", async () => {
    const { html, text } = await renderEmailTemplate(VerifyEmailEmail, {
      name: "Ada",
      verificationUrl: URL_WITH_TOKEN,
    });

    expect(html).toContain(branding.themeColor);
    expect(html).toContain(branding.displayName);
    expect(html).toContain(`href="${URL_WITH_TOKEN}"`);
    expect(text).toContain(URL_WITH_TOKEN);
    expect(text).toContain("Ada");
    expect(text).not.toMatch(ANY_TAG);
  });

  test("puts the brand's support address in the footer of every template", async () => {
    const rendered = await Promise.all([
      renderEmailTemplate(VerifyEmailEmail, { name: "Ada", verificationUrl: URL_WITH_TOKEN }),
      renderEmailTemplate(ResetPasswordEmail, { name: "Ada", resetUrl: URL_WITH_TOKEN }),
      renderEmailTemplate(InvitationEmail, {
        inviterName: "Ada",
        organizationName: "Analytical Engines",
        acceptUrl: URL_WITH_TOKEN,
      }),
      renderEmailTemplate(WelcomeTemplate, {
        appName: branding.displayName,
        userName: "Ada",
        ctaUrl: URL_WITH_TOKEN,
      }),
    ]);

    expect(rendered).toHaveLength(4);
    for (const { html, text } of rendered) {
      expect(html).toContain(branding.supportEmail);
      expect(html).toContain(branding.themeColor);
      expect(text).toContain(branding.supportEmail);
      expect(text).toContain(URL_WITH_TOKEN);
      expect(text).not.toMatch(ANY_TAG);
    }
  });
});
