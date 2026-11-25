import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createSmtpEmailProvider } from "./smtp.provider";

/** A message the in-process SMTP server received: its envelope and the raw MIME it was handed. */
type Received = { from: string; to: string[]; raw: string };

const servers: SMTPServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))),
  );
});

/** A real SMTP server on a port of its own, keeping what it is sent. Nothing is mocked. */
async function smtp() {
  const received: Received[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    onData(stream, session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push({
          from: session.envelope.mailFrom === false ? "" : session.envelope.mailFrom.address,
          to: session.envelope.rcptTo.map(({ address }) => address),
          raw: Buffer.concat(chunks).toString("utf8"),
        });
        done();
      });
    },
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.server.address() as AddressInfo;
  return { received, url: `smtp://127.0.0.1:${port}` };
}

const MESSAGE = {
  to: "ada@example.com",
  subject: "Hello Ada",
  html: "<p>Hi Ada</p>",
  text: "Hi Ada",
};

describe("the SMTP adapter", () => {
  test("hands the server one message with the recipient, the subject, an html part and a text part", async () => {
    const server = await smtp();
    const provider = createSmtpEmailProvider({ url: server.url, from: "Acme <hello@acme.dev>" });

    await provider.send(MESSAGE);

    expect(server.received).toHaveLength(1);
    const [message] = server.received;
    expect(message?.from).toBe("hello@acme.dev");
    expect(message?.to).toEqual(["ada@example.com"]);
    expect(message?.raw).toContain("Subject: Hello Ada");
    expect(message?.raw).toContain("To: ada@example.com");
    expect(message?.raw).toMatch(/Content-Type: text\/plain/i);
    expect(message?.raw).toContain("Hi Ada");
    expect(message?.raw).toMatch(/Content-Type: text\/html/i);
    expect(message?.raw).toContain("<p>Hi Ada</p>");
  });

  test("sends from the brand's legal name when no sender is given", async () => {
    const server = await smtp();

    await createSmtpEmailProvider({ url: server.url }).send(MESSAGE);

    expect(server.received[0]?.from).toBe("noreply@example.com");
  });

  test("a server that cannot be reached rejects: the failure reaches the caller", async () => {
    const server = await smtp();
    await Promise.all(
      servers.splice(0).map((open) => new Promise<void>((resolve) => open.close(resolve))),
    );

    await expect(createSmtpEmailProvider({ url: server.url }).send(MESSAGE)).rejects.toThrow();
  });
});
