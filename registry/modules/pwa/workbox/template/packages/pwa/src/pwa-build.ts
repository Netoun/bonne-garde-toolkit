#!/usr/bin/env tsx
import { resolve } from "node:path";
import { buildServiceWorker } from "./build-service-worker";

const dir = process.argv[2];
if (dir === undefined) {
  process.stderr.write("usage: pwa-build <client build directory>\n");
  process.exit(1);
}

const { count, size, warnings } = await buildServiceWorker(resolve(dir));
for (const warning of warnings) process.stderr.write(`${warning}\n`);
process.stdout.write(`Generated service worker with ${count} files (${size} bytes).\n`);
