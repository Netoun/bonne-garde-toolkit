// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding, formatEmailFrom } from "{{SCOPE}}/config";
import type { EmailMessage, EmailProvider } from "../types";

export const RESEND_API_URL = "https://api.resend.com";

/** Resend answers 403 to a request with no `User-Agent`, and `fetch` on Workers sets none. */
const USER_AGENT = "bonne-garde-email/0.1";

/**
 * The sender the legacy API used: the legal name of the brand at an address Resend will not deliver
 * from until the project verifies a domain of its own. Pass `from` for a deployed project.
 */
export const defaultFrom = formatEmailFrom(branding.legalName, "noreply@example.com");

export type ResendProviderOptions = {
  apiKey: string;
  /** `Name <address@your-domain>`: the address has to be on a domain verified in Resend. */
  from?: string;
  /** Where Resend's API is; a test points it at a server of its own. */
  baseUrl?: string;
};

/** What Resend's error body says, else the status line: the reason is Resend's, so it is worth keeping. */
async function reasonOf(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === "object" && body !== null && "message" in body) {
      const { message } = body;
      if (typeof message === "string" && message !== "") {
        return `${response.status} ${message}`;
      }
    }
  } catch {
    // not JSON: the status line is what there is
  }
  return `${response.status} ${response.statusText}`.trim();
}

/**
 * Resend over its HTTP API (`POST /emails`): plain `fetch`, so it runs the same on Workers and in a
 * container, with no SDK to bundle. A message goes as the `html` it was rendered to.
 */
export function createResendEmailProvider(options: ResendProviderOptions): EmailProvider {
  const { apiKey, from = defaultFrom, baseUrl = RESEND_API_URL } = options;
  return {
    async send(message: EmailMessage) {
      const response = await fetch(`${baseUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          from,
          to: message.to,
          subject: message.subject,
          html: message.html,
        }),
      });
      if (!response.ok) {
        throw new Error(`Email send failed: ${await reasonOf(response)}`);
      }
    },
  };
}
