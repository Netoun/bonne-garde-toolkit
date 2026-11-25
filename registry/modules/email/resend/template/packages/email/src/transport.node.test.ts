import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createTransport } from "./transport.node";

const MESSAGE = {
  to: "ada@example.com",
  subject: "Hello Ada",
  html: "<p>Hi Ada</p>",
  text: "Hi Ada",
};

const smtpServers: SMTPServer[] = [];
const httpServers: Server[] = [];

afterEach(async () => {
  await Promise.all([
    ...smtpServers.splice(0).map((server) => new Promise<void>((resolve) => server.close(resolve))),
    ...httpServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  ]);
});

/** A real SMTP server that counts the messages it is handed. */
async function smtp() {
  const received: string[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS", "AUTH"],
    onData(stream, _session, done) {
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        received.push(Buffer.concat(chunks).toString("utf8"));
        done();
      });
    },
  });
  smtpServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.server.address() as AddressInfo;
  return { received, url: `smtp://127.0.0.1:${port}` };
}

/** A real HTTP server that answers as Resend's API does, and counts the requests it gets. */
async function resend() {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(new URL(request.url ?? "/", "http://localhost").pathname);
    request.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ id: "x" }));
  });
  httpServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { paths, baseUrl: `http://127.0.0.1:${port}` };
}

describe("the transport of the dockerfile provider", () => {
  test("with SMTP_URL set, it sends through SMTP", async () => {
    const mail = await smtp();
    const api = await resend();

    await createTransport(
      { SMTP_URL: mail.url, RESEND_API_KEY: "re_live" },
      { resendBaseUrl: api.baseUrl },
    ).send(MESSAGE);

    expect(mail.received).toHaveLength(1);
    expect(mail.received[0]).toContain("Subject: Hello Ada");
    expect(api.paths).toEqual([]);
  });

  test("with only RESEND_API_KEY set, it sends through Resend", async () => {
    const api = await resend();

    await createTransport({ RESEND_API_KEY: "re_live" }, { resendBaseUrl: api.baseUrl }).send(
      MESSAGE,
    );

    expect(api.paths).toEqual(["/emails"]);
  });

  test.each([
    ["neither is set", {}],
    ["both are empty", { SMTP_URL: "", RESEND_API_KEY: "" }],
  ])("when %s, it fails naming both keys", (_what, source) => {
    expect(() => createTransport(source)).toThrow(/SMTP_URL.*RESEND_API_KEY/s);
  });
});
