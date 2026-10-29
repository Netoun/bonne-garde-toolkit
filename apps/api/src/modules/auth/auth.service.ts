import { Elysia } from "elysia";
import { createAuth } from "./auth.config";

// Singleton auth instance - created once at module load time
export const authInstance = createAuth();

export const authService = new Elysia({ name: "auth.service" }).derive({ as: "global" }, () => {
  return {
    authService: {
      api: authInstance.api,
      instance: authInstance,
    },
  };
});
