import { describe, it, expect } from "bun:test";
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
});
