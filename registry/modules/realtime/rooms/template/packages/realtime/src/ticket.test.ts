import { describe, expect, it } from "vite-plus/test";
import { InvalidTicketError, issueTicket, readTicketSecret, verifyTicket } from "./ticket";

const secret = "a-secret-of-the-test";

describe("tickets", () => {
  it("carries the room, the subject and the tags to the one that verifies it", async () => {
    const ticket = await issueTicket({
      room: "r1",
      subject: "u1",
      tags: ["staff"],
      ttlSeconds: 60,
      secret,
    });

    expect(await verifyTicket(ticket, "r1", { secret })).toMatchObject({
      room: "r1",
      subject: "u1",
      tags: ["staff"],
    });
  });

  it("rejects a tampered payload and a tampered signature", async () => {
    const ticket = await issueTicket({ room: "r1", subject: "u1", ttlSeconds: 60, secret });
    const [payload, signature] = ticket.split(".");
    const forged = btoa(
      JSON.stringify({ room: "r1", subject: "u1", tags: ["staff"], exp: 9_999_999_999 }),
    );

    await expect(verifyTicket(`${forged}.${signature}`, "r1", { secret })).rejects.toThrow(
      InvalidTicketError,
    );
    await expect(
      verifyTicket(`${payload}.${signature?.slice(0, -2)}AA`, "r1", { secret }),
    ).rejects.toThrow(InvalidTicketError);
  });

  it("rejects a ticket signed with another secret", async () => {
    const ticket = await issueTicket({
      room: "r1",
      subject: "u1",
      ttlSeconds: 60,
      secret: "other",
    });

    await expect(verifyTicket(ticket, "r1", { secret })).rejects.toMatchObject({
      reason: "signature",
    });
  });

  it("rejects an expired ticket", async () => {
    const now = Date.now();
    const ticket = await issueTicket({ room: "r1", subject: "u1", ttlSeconds: 60, secret, now });

    await expect(verifyTicket(ticket, "r1", { secret, now: now + 61_000 })).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("rejects a ticket for another room", async () => {
    const ticket = await issueTicket({ room: "r1", subject: "u1", ttlSeconds: 60, secret });

    await expect(verifyTicket(ticket, "r2", { secret })).rejects.toMatchObject({ reason: "room" });
  });

  it("rejects what is not a ticket", async () => {
    for (const ticket of ["", "abc", "a.b.c", "%%%.%%%"]) {
      await expect(verifyTicket(ticket, "r1", { secret })).rejects.toThrow(InvalidTicketError);
    }
  });
});

describe("readTicketSecret", () => {
  it("reads REALTIME_TICKET_SECRET", () => {
    expect(readTicketSecret({ REALTIME_TICKET_SECRET: "set" })).toBe("set");
  });

  it("names the variable when it is missing", () => {
    expect(() => readTicketSecret({})).toThrow(/REALTIME_TICKET_SECRET/);
  });

  it("falls back to a fixture under NODE_ENV=test only", () => {
    expect(readTicketSecret({ NODE_ENV: "test" }).length).toBeGreaterThan(16);
    expect(() => readTicketSecret({ NODE_ENV: "production" })).toThrow(/REALTIME_TICKET_SECRET/);
  });
});
