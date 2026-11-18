import { describe, expect, test } from "bun:test";
import { cliRunner } from "@bonne-garde/schema";
import { addNamingCommand } from "./force-command";

const BUNX = "bunx bonne-garde";

describe("addNamingCommand", () => {
  test("keeps what was typed, adds the names, and ends with --force", () => {
    expect(addNamingCommand(["auth/better-auth"], ["email/resend"], BUNX)).toBe(
      "bunx bonne-garde add auth/better-auth email/resend --force",
    );
    expect(
      addNamingCommand(
        ["auth/better-auth", "--no-install", "--source", "local:./registry"],
        ["email/resend", "storage/r2"],
        BUNX,
      ),
    ).toBe(
      "bunx bonne-garde add auth/better-auth --no-install --source local:./registry email/resend storage/r2 --force",
    );
  });

  test("a --force already typed is not repeated", () => {
    expect(addNamingCommand(["--force", "auth/better-auth", "--yes"], ["email/resend"], BUNX)).toBe(
      "bunx bonne-garde add auth/better-auth --yes email/resend --force",
    );
  });

  test("an argument the shell would split or expand is quoted, so the command can be pasted", () => {
    expect(
      addNamingCommand(
        ["auth/better-auth", "--source", "local:/my projects/it's here/registry"],
        ["email/resend"],
        BUNX,
      ),
    ).toBe(
      "bunx bonne-garde add auth/better-auth --source 'local:/my projects/it'\\''s here/registry' email/resend --force",
    );
  });

  test("starts with the runner of the package manager the user used, whole: it is not quoted", () => {
    expect(addNamingCommand(["a"], ["b"], "pnpm dlx bonne-garde")).toBe(
      "pnpm dlx bonne-garde add a b --force",
    );
    expect(addNamingCommand(["a"], ["b"])).toBe(`${cliRunner()} add a b --force`);
  });
});
