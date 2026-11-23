import { describe, expect, it } from "vite-plus/test";
import { decode, encode } from "./protocol";

const envelope = { v: 1, type: "chat", room: "r1", data: { text: "hi" } } as const;

describe("decode", () => {
  it("reads what encode wrote", () => {
    expect(decode(encode(envelope))).toEqual(envelope);
  });

  it("rejects an unknown version", () => {
    expect(decode(JSON.stringify({ ...envelope, v: 2 }))).toBeNull();
  });

  it("rejects what is not an envelope: text, a missing field, an extra one, an empty room", () => {
    for (const frame of [
      "not json",
      "ping",
      "null",
      JSON.stringify({ v: 1, type: "chat", data: 1 }),
      JSON.stringify({ ...envelope, extra: true }),
      JSON.stringify({ ...envelope, room: "" }),
    ]) {
      expect(decode(frame)).toBeNull();
    }
  });
});
