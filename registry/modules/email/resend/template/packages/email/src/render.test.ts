import { describe, expect, test } from "vite-plus/test";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding } from "{{SCOPE}}/config";
import { DEFAULT_EMAIL_LOCALE, emailMessages } from "./messages";
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

  describe("locale", () => {
    const props = { name: "Ada", verificationUrl: URL_WITH_TOKEN };

    test('renders a French heading and lang="fr" when the template is given locale fr', async () => {
      const { html, text } = await renderEmailTemplate(VerifyEmailEmail, {
        ...props,
        locale: "fr",
      });

      expect(html).toContain('lang="fr"');
      expect(html).toContain(emailMessages("fr").verifyEmail.heading);
      expect(emailMessages("fr").verifyEmail.heading).not.toBe(
        emailMessages("en").verifyEmail.heading,
      );
      expect(html).not.toContain(emailMessages("en").verifyEmail.heading);
      expect(text).toContain(URL_WITH_TOKEN);
    });

    test('renders English and lang="en" without a locale', async () => {
      const { html } = await renderEmailTemplate(VerifyEmailEmail, props);

      expect(DEFAULT_EMAIL_LOCALE).toBe("en");
      expect(html).toContain('lang="en"');
      expect(html).toContain("Verify your email address");
    });

    test("translates the footer and every template, so no English is left in a French email", async () => {
      const rendered = await Promise.all([
        renderEmailTemplate(ResetPasswordEmail, {
          name: "Ada",
          resetUrl: URL_WITH_TOKEN,
          locale: "fr",
        }),
        renderEmailTemplate(InvitationEmail, {
          inviterName: "Ada",
          organizationName: "Analytical Engines",
          acceptUrl: URL_WITH_TOKEN,
          locale: "fr",
        }),
        renderEmailTemplate(WelcomeTemplate, {
          appName: branding.displayName,
          userName: "Ada",
          ctaUrl: URL_WITH_TOKEN,
          locale: "fr",
        }),
      ]);
      const fr = emailMessages("fr");

      expect(rendered[0]?.html).toContain(fr.resetPassword.heading);
      expect(rendered[1]?.html).toContain(fr.invitation.heading("Ada", "Analytical Engines"));
      expect(rendered[2]?.html).toContain(fr.welcome.heading(branding.displayName));
      for (const { html, text } of rendered) {
        expect(html).toContain('lang="fr"');
        expect(html).toContain(fr.footer.questions);
        expect(text).toContain(URL_WITH_TOKEN);
      }
    });
  });
});
