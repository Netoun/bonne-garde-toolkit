import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vite-plus/test";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding } from "{{SCOPE}}/config";
import { createResendEmailProvider } from "./resend.provider";

/** A request the stand-in for Resend's API received. */
type Received = { method: string; path: string; headers: IncomingHttpHeaders; body: unknown };

const servers: Server[] = [];

function stop(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(stop));
});

/**
 * A real HTTP server that answers as Resend's API does, on a port of its own: the provider is asked
 * to use its URL, and `fetch` is the one the runtime has. Nothing is mocked.
 */
async function resend(answer: () => Response) {
  const received: Received[] = [];
  const server = createServer(async (request, response) => {
    let text = "";
    request.setEncoding("utf8");
    for await (const chunk of request) {
      text += String(chunk);
    }
    received.push({
      method: request.method ?? "",
      path: new URL(request.url ?? "/", "http://localhost").pathname,
      headers: request.headers,
      body: text === "" ? null : JSON.parse(text),
    });
    const answered = answer();
    response.writeHead(answered.status, answered.statusText, Object.fromEntries(answered.headers));
    response.end(await answered.text());
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the stand-in for Resend listens on no port");
  }
  return { received, baseUrl: `http://127.0.0.1:${address.port}` };
}

const MESSAGE = {
  to: "ada@example.com",
  subject: "Hello",
  html: "<p>Hi Ada</p>",
  text: "Hi Ada",
};

describe("the Resend adapter", () => {
  test("posts the message to /emails as Resend's API takes it, with the key and a User-Agent", async () => {
    const api = await resend(() => Response.json({ id: "49a3999c" }));
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
    expect(request?.headers.authorization).toBe("Bearer re_secret");
    expect(request?.headers["content-type"]).toBe("application/json");
    // Resend answers 403 to a request that has none.
    expect(request?.headers["user-agent"]).toContain("bonne-garde-email");
    expect(request?.body).toEqual({
      from: "Acme <hello@acme.dev>",
      to: "ada@example.com",
      subject: "Hello",
      html: "<p>Hi Ada</p>",
      text: "Hi Ada",
    });
  });

  test("posts the plain-text part beside the html one, as it was given", async () => {
    const api = await resend(() => Response.json({ id: "x" }));
    const provider = createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl });

    await provider.send({ ...MESSAGE, text: "Hi Ada,\nOpen https://acme.dev/verify" });

    expect(api.received[0]?.body).toMatchObject({
      html: MESSAGE.html,
      text: "Hi Ada,\nOpen https://acme.dev/verify",
    });
  });

  test("sends from the brand's legal name when no sender is given", async () => {
    const api = await resend(() => Response.json({ id: "x" }));

    await createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl }).send(MESSAGE);

    expect(api.received[0]?.body).toMatchObject({
      from: `${branding.legalName} <noreply@example.com>`,
    });
  });

  test("an error Resend answers with is thrown with its message, and never carries the key", async () => {
    const api = await resend(() =>
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
    const api = await resend(
      () => new Response("upstream down", { status: 502, statusText: "Bad Gateway" }),
    );
    const provider = createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl });

    await expect(provider.send(MESSAGE)).rejects.toThrow("Email send failed: 502 Bad Gateway");
  });

  test("a server that cannot be reached rejects: the failure reaches the caller", async () => {
    const api = await resend(() => Response.json({ id: "x" }));
    const provider = createResendEmailProvider({ apiKey: "re_secret", baseUrl: api.baseUrl });
    await Promise.all(servers.splice(0).map(stop));

    await expect(provider.send(MESSAGE)).rejects.toThrow();
  });
});
