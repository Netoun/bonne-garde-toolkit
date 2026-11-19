#!/usr/bin/env bun
import { runCli } from "./cli";
import { colorEnabled, painter } from "./terminal";

const code = await runCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(painter(colorEnabled(process.stderr))("red", message));
  return 1;
});
process.exit(code);
