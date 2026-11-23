import { describe, expect, it } from "vite-plus/test";
import { roomState } from "./rooms";

// No driver is loaded in this file: it imports `rooms` alone.
describe("roomState without a driver", () => {
  it("throws, like publishToRoom, instead of keeping nothing", () => {
    expect(() => roomState("lobby")).toThrow(/No realtime driver is loaded/);
  });
});
