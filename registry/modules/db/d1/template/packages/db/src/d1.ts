/// <reference types="@cloudflare/workers-types" />
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";

/** The `binding` of the `d1_databases` entry this module writes into the Worker's `wrangler.jsonc`. */
export const D1_BINDING = "DB";

const UNBOUND = `The D1 binding "${D1_BINDING}" is not available in this runtime. Run the API with wrangler (\`bun run dev\` in apps/api), which provides it, or hand the code a database of your own.`;

function unbound(): never {
  throw new Error(UNBOUND);
}

/**
 * What stands in for the binding where the runtime has none, in a unit test or under `bun run`: a
 * database that fails with a message naming the binding the first time something uses it. The code
 * that holds it (an Elysia app, `/health` and every route that does not query) loads and answers
 * without a database, and the route that does query it says what is missing.
 */
class UnboundD1 implements D1Database {
  prepare(): never {
    return unbound();
  }
  batch(): never {
    return unbound();
  }
  exec(): never {
    return unbound();
  }
  withSession(): never {
    return unbound();
  }
  dump(): never {
    return unbound();
  }
}

/** The shape every D1 binding has, which is what tells it from an environment variable of the same name. */
function isD1Database(value: unknown): value is D1Database {
  return (
    typeof value === "object" &&
    value !== null &&
    "prepare" in value &&
    typeof value.prepare === "function" &&
    "batch" in value &&
    typeof value.batch === "function" &&
    "exec" in value &&
    typeof value.exec === "function"
  );
}

/** The D1 binding of `env`, or the database that fails when it is first used. */
export function bindD1(env: Record<string, unknown>): D1Database {
  const binding = env[D1_BINDING];
  return isD1Database(binding) ? binding : new UnboundD1();
}

/** The D1 binding of the runtime the code runs on, read through the provider's `readRuntimeEnv`. */
export async function readD1(): Promise<D1Database> {
  return bindD1(await readRuntimeEnv());
}
