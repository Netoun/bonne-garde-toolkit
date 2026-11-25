import { handle, opencode } from "../../scripts/agent-hooks/adapters.ts";
import { nodeDeps } from "../../scripts/agent-hooks/deps.ts";

type Hooked = { tool: string; args?: unknown };

/**
 * OpenCode loads this file on its own. The hooks run in-process, through the same adapter contract as
 * the Claude and Cursor processes: a refused tool call throws, and a failed end-of-turn check is sent
 * back to the session once as a new prompt.
 */
export const AgentHooks = async ({
  directory,
  client,
}: {
  directory: string;
  client: { session: { prompt(request: unknown): Promise<unknown> } };
}) => {
  const deps = nodeDeps(directory);
  let retried = false;
  return {
    "tool.execute.before": async (input: Hooked, output: { args: unknown }) => {
      const reply = handle(
        opencode,
        { hook: "tool.execute.before", tool: input.tool, args: output.args },
        directory,
        deps,
      );
      if (reply.code === 2) throw new Error(reply.stderr);
    },
    "tool.execute.after": async (input: Hooked) => {
      handle(
        opencode,
        { hook: "tool.execute.after", tool: input.tool, args: input.args },
        directory,
        deps,
      );
    },
    event: async ({ event }: { event: { type: string; properties?: { sessionID?: string } } }) => {
      if (event.type !== "session.idle") return;
      const reply = handle(opencode, { hook: "session.idle", retry: retried }, directory, deps);
      retried = reply.code === 2;
      if (retried) {
        await client.session.prompt({
          path: { id: event.properties?.sessionID },
          body: { parts: [{ type: "text", text: reply.stderr }] },
        });
      }
    },
  };
};
