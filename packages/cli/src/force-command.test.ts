import { describe, expect, test } from "bun:test";
import { addNamingCommand } from "./force-command";

describe("addNamingCommand", () => {
  test("keeps what was typed, adds the names, and ends with --force", () => {
    expect(addNamingCommand(["auth/better-auth"], ["email/resend"])).toBe(
      "bg add auth/better-auth email/resend --force",
    );
    expect(
      addNamingCommand(
        ["auth/better-auth", "--no-install", "--source", "local:./registry"],
        ["email/resend", "storage/r2"],
      ),
    ).toBe(
      "bg add auth/better-auth --no-install --source local:./registry email/resend storage/r2 --force",
    );
  });

  test("a --force already typed is not repeated", () => {
    expect(addNamingCommand(["--force", "auth/better-auth", "--yes"], ["email/resend"])).toBe(
      "bg add auth/better-auth --yes email/resend --force",
    );
  });

  test("an argument the shell would split or expand is quoted, so the command can be pasted", () => {
    expect(
      addNamingCommand(
        ["auth/better-auth", "--source", "local:/my projects/it's here/registry"],
        ["email/resend"],
      ),
    ).toBe(
      "bg add auth/better-auth --source 'local:/my projects/it'\\''s here/registry' email/resend --force",
    );
  });
});
