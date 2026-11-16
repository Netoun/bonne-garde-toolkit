import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { runCommand } from "./run-command";

describe("runCommand", () => {
  test("waits for the command and returns its exit code", async () => {
    expect(
      await runCommand(process.execPath, ["-e", "process.exit(3)"], {
        cwd: tmpdir(),
        stdio: "ignore",
      }),
    ).toEqual({ status: "exited", code: 3 });
    expect(
      await runCommand(process.execPath, ["-e", "process.exit(0)"], {
        cwd: tmpdir(),
        stdio: "ignore",
      }),
    ).toEqual({ status: "exited", code: 0 });
  });

  test("a command that is not on PATH is a result, not a thrown ENOENT", async () => {
    expect(
      await runCommand("a-command-that-does-not-exist", [], { cwd: tmpdir(), stdio: "ignore" }),
    ).toEqual({ status: "not-found" });
  });

  test("a command a signal ended did not succeed", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.kill(process.pid, 'SIGKILL')"],
      {
        cwd: tmpdir(),
        stdio: "ignore",
      },
    );
    expect(result.status).toBe("exited");
    expect(result).not.toEqual({ status: "exited", code: 0 });
  });
});
