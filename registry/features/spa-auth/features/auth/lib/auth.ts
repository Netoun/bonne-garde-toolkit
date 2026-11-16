import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  inferOrgAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { AUTH_BASE_PATH, type Auth } from "@acme/auth/client";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL,
  basePath: AUTH_BASE_PATH,
  plugins: [
    inferAdditionalFields<Auth>(),
    organizationClient({ schema: inferOrgAdditionalFields<Auth>() }),
  ],
});
