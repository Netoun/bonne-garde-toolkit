#!/usr/bin/env bun
import { runCli } from "./cli";
import { errorText } from "./errors";

const code = await runCli(process.argv.slice(2)).catch((error: unknown) => {
  console.error(errorText(error));
  return 1;
});
process.exit(code);
