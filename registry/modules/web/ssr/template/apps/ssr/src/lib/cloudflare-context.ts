import { createContext } from "react-router";

/**
 * The Worker's bindings and vars. What adds one declares it by augmenting this interface where it
 * reads it, as `api.server.ts` does when the project has the API.
 */
export interface WorkerEnv {}

export const cloudflareContext = createContext<{
  env: WorkerEnv;
  ctx: ExecutionContext;
} | null>(null);
