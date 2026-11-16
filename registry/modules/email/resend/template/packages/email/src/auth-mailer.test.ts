import { beforeEach, describe, expect, test } from "bun:test";
import { createAuthMailer, emailMailer } from "./auth-mailer";
import { createMemoryEmailProvider } from "./providers/memory.provider";
import { clearOutbox, outbox } from "./testing";
import type { EmailMessage } from "./types";

const URL_WITH_TOKEN = "http://spa.test/auth/verify-email?token=one-time-token";

describe("the mailer auth is wired to", () => {
  test("renders the verification email with the recipient's name and the link, and sends it", async () => {
    const sent: EmailMessage[] = [];
    const mailer = createAuthMailer(async () => createMemoryEmailProvider(sent));

    await mailer.sendVerificationEmail({ to: "ada@example.com", name: "Ada", url: URL_WITH_TOKEN });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("ada@example.com");
    expect(sent[0]?.subject).toBe("Verify your email address");
    expect(sent[0]?.html).toContain("Hi Ada,");
    expect(sent[0]?.html).toContain(`href="${URL_WITH_TOKEN}"`);
  });

  test("renders the password reset email the same way", async () => {
    const sent: EmailMessage[] = [];
    const mailer = createAuthMailer(async () => createMemoryEmailProvider(sent));
    const url = "http://spa.test/auth/reset-password?token=another-token";

    await mailer.sendPasswordReset({ to: "ada@example.com", name: "Ada", url });

    expect(sent[0]?.subject).toBe("Reset your password");
    expect(sent[0]?.html).toContain("Hi Ada,");
    expect(sent[0]?.html).toContain(`href="${url}"`);
  });

  test("asks for the adapter when it sends, not when it is made, and lets what the adapter throws through", async () => {
    let asked = 0;
    const mailer = createAuthMailer(async () => {
      asked += 1;
      throw new Error("Missing required environment variable: RESEND_API_KEY");
    });
    expect(asked).toBe(0);

    await expect(
      mailer.sendVerificationEmail({ to: "ada@example.com", name: "Ada", url: URL_WITH_TOKEN }),
    ).rejects.toThrow("RESEND_API_KEY");
    expect(asked).toBe(1);
  });

  describe("emailMailer, the one a project's auth runs with", () => {
    beforeEach(clearOutbox);

    test("delivers to the test outbox, through the memory adapter the runtime picks under test", async () => {
      await emailMailer.sendVerificationEmail({
        to: "ada@example.com",
        name: "Ada",
        url: URL_WITH_TOKEN,
      });

      expect(outbox.map(({ to, subject }) => [to, subject])).toEqual([
        ["ada@example.com", "Verify your email address"],
      ]);
      expect(outbox[0]?.html).toContain(URL_WITH_TOKEN);
    });
  });
});
