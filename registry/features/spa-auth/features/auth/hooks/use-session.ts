import { authClient } from "@acme/spa/features/auth/lib/auth";

export function useSession() {
  return authClient.useSession();
}
