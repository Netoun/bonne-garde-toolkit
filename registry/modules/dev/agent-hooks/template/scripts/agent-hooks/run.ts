import { readFileSync } from "node:fs";
import { ADAPTERS, handle } from "./adapters.ts";
import { nodeDeps } from "./deps.ts";

/** `tsx scripts/agent-hooks/run.ts <claude|cursor>`: the agent's JSON on stdin, its answer on stdout / stderr / exit code. */
function main(): void {
  const name = process.argv[2];
  const adapter =
    name !== undefined && name in ADAPTERS ? ADAPTERS[name as keyof typeof ADAPTERS] : undefined;
  if (!adapter) {
    process.stderr.write(`usage: run.ts <${Object.keys(ADAPTERS).join("|")}>\n`);
    process.exit(1);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const reply = handle(adapter, payload, process.cwd(), nodeDeps(process.cwd()));
  if (reply.stdout) process.stdout.write(`${reply.stdout}\n`);
  if (reply.stderr) process.stderr.write(`${reply.stderr}\n`);
  process.exitCode = reply.code;
}

main();
