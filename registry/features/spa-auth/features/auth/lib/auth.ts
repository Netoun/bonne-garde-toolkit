import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  inferOrgAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { AUTH_BASE_PATH, type Auth } from "@acme/auth/client";
// oxfmt-ignore
import { ac, roles } from "@acme/auth/permissions";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
  basePath: AUTH_BASE_PATH,
  fetchOptions: {
    // Resolve fetch at request time so Vitest + MSW can patch global fetch in setupFiles.
    customFetchImpl: (...args) => globalThis.fetch(...args),
  },
  plugins: [
    inferAdditionalFields<Auth>(),
    organizationClient({ ac, roles, schema: inferOrgAdditionalFields<Auth>() }),
  ],
});
