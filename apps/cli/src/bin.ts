#!/usr/bin/env bun
import { runCli } from "./cli";

const code = await runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  return 1;
});
process.exit(code);
