import { createContext } from "react-router";

export interface WorkerEnv {
  API_URL: string;
}

export const cloudflareContext = createContext<{
  env: WorkerEnv;
  ctx: ExecutionContext;
} | null>(null);
