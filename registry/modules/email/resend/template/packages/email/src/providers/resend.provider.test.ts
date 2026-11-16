import { afterEach, describe, expect, test } from "bun:test";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding } from "{{SCOPE}}/config";
import { createResendEmailProvider } from "./resend.provider";

/** A request the stand-in for Resend's API received. */
type Received = { method: string; path: string; headers: Headers; body: unknown };

const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) {
    void server.stop(true);
  }
});

/**
 * A real HTTP server that answers as Resend's API does, on a port of its own: the provider is asked
 * to use its URL, and `fetch` is the one the runtime has. Nothing is mocked.
 */
function resend(answer: (request: Request) => Response | Promise<Response>) {
  const received: Received[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const text = await request.text();
      received.push({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: request.headers,
        body: text === "" ? null : JSON.parse(text),
      });
      return answer(request);
    },
  });
  servers.push(server);
  return { received, baseUrl: server.url.origin };
}

const MESSAGE = { to: "ada@example.com", subject: "Hello", html: "<p>Hi Ada</p>" };

describe("the Resend adapter", () => {
  test("posts the message to /emails as Resend's API takes it, with the key and a User-Agent", async () => {
    const api = resend(() => Response.json({ id: "49a3999c" }));
    const provider = createResendEmailProvider({
      apiKey: "re_secret",
      from: "Acme <hello@acme.dev>",
      baseUrl: api.baseUrl,
    });

    await provider.send(MESSAGE);

    expect(api.received).toHaveLength(1);
    const [request] = api.received;
    expect(request?.method).toBe("POST");
    expect(request?.path).toBe("/emails");
    expect(request?.headers.get("authorization")).toBe("Bearer re_secret");
    expect(request?.headers.get("content-type")).toBe("application/json");
    // Resend answers 403 to a request that has none.
    expect(request?.headers.get("user-agent")).toContain("bonne-garde-email");
    expect(request?.body).toEqual({
      from: "Acme <hello@acme.dev>",
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hi Ada</p>",
    });
  });

  test("sends from the brand's legal name when no sender is given", async () => {
    const api = resend(() => Response.json({ id: "x" }));

    await createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl }).send(MESSAGE);

    expect(api.received[0]?.body).toMatchObject({
      from: `${branding.legalName} <noreply@example.com>`,
    });
  });

  test("an error Resend answers with is thrown with its message, and never carries the key", async () => {
    const api = resend(() =>
      Response.json(
        { name: "validation_error", message: "The from address is not verified" },
        { status: 422 },
      ),
    );
    const provider = createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl });

    const failure = await provider.send(MESSAGE).catch((error: unknown) => error);

    if (!(failure instanceof Error)) {
      throw new Error("send did not reject");
    }
    expect(failure.message).toBe("Email send failed: 422 The from address is not verified");
    expect(failure.message).not.toContain("re_secret");
  });

  test("an answer that is not Resend's JSON is reported by its status line", async () => {
    const api = resend(
      () => new Response("upstream down", { status: 502, statusText: "Bad Gateway" }),
    );
    const provider = createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl });

    await expect(provider.send(MESSAGE)).rejects.toThrow("Email send failed: 502 Bad Gateway");
  });

  test("a server that cannot be reached rejects: the failure reaches the caller", async () => {
    const api = resend(() => Response.json({ id: "x" }));
    const provider = createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl });
    await Promise.all(servers.splice(0).map((server) => server.stop(true)));

    await expect(provider.send(MESSAGE)).rejects.toThrow();
  });
});
