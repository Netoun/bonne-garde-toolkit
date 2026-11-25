import { describe, expect, test } from "bun:test";
import { CliError, closest, errorText, notAProject } from "./errors";

describe("closest", () => {
  test("finds a typo, a transposition and a missing letter", () => {
    expect(closest("lst", ["create", "list", "add"])).toBe("list");
    expect(closest("--itmes", ["--items", "--category", "--source"])).toBe("--items");
    expect(closest("docter", ["doctor", "record"])).toBe("doctor");
  });

  test("finds nothing when nothing is near", () => {
    expect(closest("xyz", ["create", "list", "add"])).toBeUndefined();
  });
});

describe("errorText", () => {
  test("splits a CliError into title, cause and fix", () => {
    const error = new CliError("Not a Bonne Garde project", {
      cause: "No bg.json in /tmp/x.",
      fix: "Create one: bonne-garde create <dir>",
    });
    expect(errorText(error)).toBe(
      "✖ Not a Bonne Garde project\n  No bg.json in /tmp/x.\n  Create one: bonne-garde create <dir>",
    );
  });

  test("keeps the first line of a plain error as the title and the other lines as they are", () => {
    expect(errorText(new Error("boom\n  more"))).toBe("✖ boom\n  more");
    expect(errorText("odd")).toBe("✖ odd");
  });

  test("notAProject names the directory", () => {
    expect(errorText(notAProject("/tmp/x"))).toContain("No bg.json in /tmp/x.");
  });
});
