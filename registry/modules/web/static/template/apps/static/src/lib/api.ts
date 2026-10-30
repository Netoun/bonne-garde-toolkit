import { treaty } from "@elysiajs/eden";
import type { App } from "{{SCOPE}}/api/app";

function resolveApiUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL;
  new URL(apiUrl);
  return apiUrl;
}

export const api = treaty<App>(resolveApiUrl(), {
  fetch: { credentials: "include" },
});

// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
export type { ApiRoute, EdenResponse, EdenBody, EdenQuery } from "{{SCOPE}}/api/lib/eden";
