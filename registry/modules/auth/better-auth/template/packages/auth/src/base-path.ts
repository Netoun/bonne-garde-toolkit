/**
 * Where the API serves Better Auth, and so the `basePath` of the client. It is Better Auth's own
 * default, and not `/auth`: with the provider that serves the SPA and the API from one origin
 * (`dockerfile`), the SPA's pages are at `/auth/login`, `/auth/verify-email` and the like, which the
 * links in emails open, and an API at the same path answers them with JSON.
 */
export const AUTH_BASE_PATH = "/api/auth";
