import { authClient } from "@acme/spa/lib/auth";

export function useSession() {
  return authClient.useSession();
}
