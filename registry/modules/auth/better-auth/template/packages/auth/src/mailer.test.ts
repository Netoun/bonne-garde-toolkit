import { describe, it, expect } from "vite-plus/test";
import { unconfiguredMailer } from "./mailer";

const URL_WITH_TOKEN = "http://spa.test/auth/verify-email?token=one-time-token";

describe("the mailer an email module replaces", () => {
  it("sends nothing, says so, and never logs the link it was handed", async () => {
    const lines: string[] = [];
    const mailer = unconfiguredMailer({
      warn: (message, context) => lines.push(JSON.stringify({ message, ...context })),
    });
    const email = { userId: "u1", to: "a@example.com", name: "A", url: URL_WITH_TOKEN };

    await mailer.sendVerificationEmail(email);
    await mailer.sendPasswordReset(email);

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain("No email module is installed");
      expect(line).toContain('"userId":"u1"');
      expect(line).not.toContain("one-time-token");
      expect(line).not.toContain("a@example.com");
    }
  });

  it("does not send an invitation either, and never logs its link", async () => {
    const lines: string[] = [];
    const mailer = unconfiguredMailer({
      warn: (message, context) => lines.push(JSON.stringify({ message, ...context })),
    });

    await mailer.sendInvitation?.({
      to: "a@example.com",
      inviterName: "B",
      organizationName: "Team",
      url: "http://spa.test/invitations/invitation-id",
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("the invitation email was not sent");
    expect(lines[0]).not.toContain("invitation-id");
    expect(lines[0]).not.toContain("a@example.com");
  });
});
