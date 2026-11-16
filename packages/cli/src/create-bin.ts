#!/usr/bin/env bun
import { runCli } from "./cli";

const args = process.argv.slice(2);
const argv = args[0] === "create" ? args : ["create", ...args];
const code = await runCli(argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  return 1;
});
process.exit(code);
