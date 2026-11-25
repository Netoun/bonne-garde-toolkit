import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { claude, cursor, handle, opencode, type Deps } from "./adapters.ts";
import type { Exec, HookEvent } from "./contract.ts";
import { formatAfterEdit } from "./format.ts";
import { guard } from "./guard.ts";
import { stopCheck } from "./stop-check.ts";

const CWD = "/project";
const shell = (command: string): HookEvent => ({ kind: "shell", command, cwd: CWD });
const edit = (path: string, phase: "before" | "after" = "before"): HookEvent => ({
  kind: "edit",
  phase,
  path,
  cwd: CWD,
});

/** An executor that records its calls and answers from `answers` by command prefix (default: success, no output). */
function recorder(answers: Record<string, { code: number; output: string }> = {}) {
  const calls: { command: string[]; cwd: string }[] = [];
  const exec: Exec = (command, cwd) => {
    calls.push({ command, cwd });
    const key = Object.keys(answers).find((prefix) => command.join(" ").startsWith(prefix));
    return key ? (answers[key] ?? { code: 0, output: "" }) : { code: 0, output: "" };
  };
  return { exec, calls };
}

describe("guard", () => {
  it.each([
    "bun.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "bg.json",
    "packages/config/src/branding.generated.ts",
    "/project/yarn.lock",
  ])("refuses an edit of the generated file %s", (path) => {
    const result = guard(edit(path));
    expect(result.block).toBe(true);
  });

  it.each(["src/index.ts", "apps/api/package.json", "/project/README.md", "docs/bg.json.md"])(
    "lets an edit of %s through",
    (path) => {
      expect(guard(edit(path))).toEqual({ block: false });
    },
  );

  it.each([
    ["npm install", undefined],
    ["npx vitest", undefined],
    ["cd app && yarn add left-pad", undefined],
    ["FOO=1 sudo pnpm install", "yarn@4.0.0"],
    ["echo ok | npm run test", "pnpm@10.0.0"],
    ["git push origin main", undefined],
    ["git -C ../other push", undefined],
    ["(git push)", undefined],
  ])("refuses `%s`", (command, packageManager) => {
    expect(guard(shell(command), { packageManager }).block).toBe(true);
  });

  it.each([
    ["pnpm install", "pnpm@10.0.0"],
    ["git status && git commit -m 'fix: npm and git push in a message'", undefined],
    ["git pull --rebase", undefined],
    ["echo npm", undefined],
    ["cat <<'EOF'\nnpm install\nEOF", undefined],
    ["vp run check", undefined],
  ])("lets `%s` through", (command, packageManager) => {
    expect(guard(shell(command), { packageManager })).toEqual({ block: false });
  });

  it("tells the agent which package manager the project uses", () => {
    const result = guard(shell("npm install"), { packageManager: "pnpm@10.0.0" });
    expect(result).toMatchObject({ block: true, message: expect.stringContaining("pnpm") });
  });

  it("ignores the events that are not its own", () => {
    expect(guard({ kind: "stop", cwd: CWD, retry: false })).toEqual({ block: false });
    expect(guard(edit("bg.json", "after"))).toEqual({ block: false });
  });
});

describe("stop-check", () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  /** A project with `packages/db` (a `typecheck` script) and `packages/notes` (none). */
  function project(): string {
    const root = mkdtempSync(join(tmpdir(), "agent-hooks-"));
    scratch.push(root);
    for (const [name, scripts] of [
      ["db", { typecheck: "tsc" }],
      ["notes", {}],
    ] as const) {
      mkdirSync(join(root, "packages", name), { recursive: true });
      writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ scripts }));
    }
    return root;
  }

  const listing = (diff: string, untracked = "") => ({
    "git diff": { code: 0, output: diff },
    "git ls-files": { code: 0, output: untracked },
  });

  it("runs vp check on the changed code files only, and the typecheck of their package", () => {
    const root = project();
    const { exec, calls } = recorder(
      listing("packages/db/src/a.ts\nREADME.md\nnode_modules/x/y.ts", "src/new.tsx"),
    );

    const result = stopCheck({ kind: "stop", cwd: root, retry: false }, exec);

    expect(result).toEqual({ block: false });
    expect(calls.map(({ command }) => command.join(" "))).toEqual([
      "git diff --name-only --diff-filter=ACMR HEAD",
      "git ls-files --others --exclude-standard",
      "vp check packages/db/src/a.ts src/new.tsx",
      "vp run typecheck",
    ]);
    expect(calls.at(-1)?.cwd).toBe(join(root, "packages/db"));
  });

  it("runs no check when no code file changed, nor the typecheck of a package without one", () => {
    const root = project();
    const none = recorder(listing("README.md"));
    expect(stopCheck({ kind: "stop", cwd: root, retry: false }, none.exec)).toEqual({
      block: false,
    });
    expect(none.calls).toHaveLength(2);

    const notes = recorder(listing("packages/notes/index.ts"));
    stopCheck({ kind: "stop", cwd: root, retry: false }, notes.exec);
    expect(notes.calls.map(({ command }) => command[0])).toEqual(["git", "git", "vp"]);
  });

  it("blocks the stop with the end of the failure output, then only warns on a retry", () => {
    const root = project();
    const failing = {
      ...listing("src/a.ts"),
      "vp check": { code: 1, output: "line\n".repeat(100) + "bad import" },
    };

    const first = stopCheck({ kind: "stop", cwd: root, retry: false }, recorder(failing).exec);
    expect(first.block).toBe(true);
    const message = first.block ? first.message : "";
    expect(message).toContain("bad import");
    expect(message.split("\n").length).toBeLessThan(60);

    const retry = stopCheck({ kind: "stop", cwd: root, retry: true }, recorder(failing).exec);
    expect(retry).toMatchObject({ block: false, warning: expect.stringContaining("bad import") });
  });

  it("ignores the events that are not its own", () => {
    const { exec, calls } = recorder();
    expect(stopCheck(edit("a.ts", "after"), exec)).toEqual({ block: false });
    expect(calls).toEqual([]);
  });
});

describe("format", () => {
  it("runs vp fmt --write on the edited file, after the edit", () => {
    const { exec, calls } = recorder();
    expect(formatAfterEdit(edit("/project/src/a.ts", "after"), exec)).toEqual({ block: false });
    expect(calls).toEqual([{ command: ["vp", "fmt", "--write", "/project/src/a.ts"], cwd: CWD }]);
  });

  it("leaves other files, other phases and other events alone", () => {
    const { exec, calls } = recorder();
    formatAfterEdit(edit("/project/logo.png", "after"), exec);
    formatAfterEdit(edit("/project/src/a.ts", "before"), exec);
    formatAfterEdit(shell("ls"), exec);
    expect(calls).toEqual([]);
  });

  it("warns, and does not block, when the formatter fails", () => {
    const { exec } = recorder({ "vp fmt": { code: 1, output: "syntax error" } });
    expect(formatAfterEdit(edit("/project/src/a.ts", "after"), exec)).toMatchObject({
      block: false,
      warning: expect.stringContaining("syntax error"),
    });
  });
});

describe("adapters read the same contract", () => {
  const deps = (exec: Exec = recorder().exec): Deps => ({ exec, options: {} });

  it("Claude Code: a refused Bash call exits 2 with the reason on stderr", () => {
    const payload = {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git push" },
      cwd: CWD,
    };
    expect(claude.parse(payload, "/elsewhere")).toEqual(shell("git push"));
    const reply = handle(claude, payload, CWD, deps());
    expect(reply.code).toBe(2);
    expect(reply.stderr).toContain("git push");
  });

  it("Claude Code: edits, formatting and stop", () => {
    const write = {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: "bun.lock" },
    };
    expect(handle(claude, write, CWD, deps()).code).toBe(2);
    const after = {
      hook_event_name: "PostToolUse",
      tool_name: "Edit",
      tool_input: { file_path: "/project/a.ts" },
    };
    expect(claude.parse(after, CWD)).toEqual(edit("/project/a.ts", "after"));
    expect(claude.parse({ hook_event_name: "Stop", stop_hook_active: true }, CWD)).toEqual({
      kind: "stop",
      cwd: CWD,
      retry: true,
    });
    expect(
      claude.parse({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: {} }, CWD),
    ).toBeUndefined();
    expect(
      handle(
        claude,
        { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } },
        CWD,
        deps(),
      ).code,
    ).toBe(0);
  });

  it("Cursor: a refused command is a deny answer and exit 2, an allowed one an allow", () => {
    const payload = { hook_event_name: "beforeShellExecution", command: "npm install", cwd: CWD };
    expect(cursor.parse(payload, CWD)).toEqual(shell("npm install"));
    const denied = handle(cursor, payload, CWD, deps());
    expect(denied.code).toBe(2);
    expect(JSON.parse(denied.stdout)).toMatchObject({
      permission: "deny",
      user_message: expect.stringContaining("npm"),
    });
    const allowed = handle(cursor, { ...payload, command: "ls" }, CWD, deps());
    expect([allowed.code, JSON.parse(allowed.stdout)]).toEqual([0, { permission: "allow" }]);
  });

  it("Cursor: preToolUse Write, afterFileEdit and stop", () => {
    const write = {
      hook_event_name: "preToolUse",
      tool_name: "Write",
      tool_input: { file_path: "pnpm-lock.yaml" },
    };
    expect(handle(cursor, write, CWD, deps()).code).toBe(2);
    expect(
      cursor.parse(
        { hook_event_name: "preToolUse", tool_name: "Shell", tool_input: { command: "ls" } },
        CWD,
      ),
    ).toEqual(shell("ls"));
    expect(
      cursor.parse({ hook_event_name: "afterFileEdit", file_path: "/project/a.ts" }, CWD),
    ).toEqual(edit("/project/a.ts", "after"));
    expect(cursor.parse({ hook_event_name: "stop", loop_count: 1 }, CWD)).toEqual({
      kind: "stop",
      cwd: CWD,
      retry: true,
    });
  });

  it("OpenCode: the plugin's tool and idle calls give the same events", () => {
    expect(
      opencode.parse({ hook: "tool.execute.before", tool: "bash", args: { command: "yarn" } }, CWD),
    ).toEqual(shell("yarn"));
    expect(
      opencode.parse(
        { hook: "tool.execute.before", tool: "edit", args: { filePath: "bg.json" } },
        CWD,
      ),
    ).toEqual(edit("bg.json"));
    expect(
      opencode.parse(
        { hook: "tool.execute.after", tool: "write", args: { filePath: "a.ts" } },
        CWD,
      ),
    ).toEqual(edit("a.ts", "after"));
    expect(opencode.parse({ hook: "session.idle", retry: true }, CWD)).toEqual({
      kind: "stop",
      cwd: CWD,
      retry: true,
    });
    expect(
      opencode.parse({ hook: "tool.execute.before", tool: "read", args: {} }, CWD),
    ).toBeUndefined();

    const refused = handle(
      opencode,
      { hook: "tool.execute.before", tool: "bash", args: { command: "yarn" } },
      CWD,
      deps(),
    );
    expect(refused.code).toBe(2);
    expect(refused.stderr).toContain("yarn");
  });

  it("Stop: a failing check blocks in each agent's own way", () => {
    const { exec } = recorder({
      "git diff": { code: 0, output: "a.ts" },
      "vp check": { code: 1, output: "lint error" },
    });
    expect(handle(claude, { hook_event_name: "Stop" }, CWD, deps(exec))).toMatchObject({
      code: 2,
      stderr: expect.stringContaining("lint error"),
    });
    const cursorStop = handle(cursor, { hook_event_name: "stop", loop_count: 0 }, CWD, deps(exec));
    expect(JSON.parse(cursorStop.stdout)).toMatchObject({
      followup_message: expect.stringContaining("lint error"),
    });
    expect(handle(opencode, { hook: "session.idle" }, CWD, deps(exec)).code).toBe(2);
  });
});
