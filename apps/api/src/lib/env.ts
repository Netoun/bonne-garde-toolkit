export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;

  BETTER_AUTH_SECRET: string;
  RESEND_API_KEY: string;

  API_URL: string;
  R2_PUBLIC_URL: string;
  SPA_URL: string;
  SSR_URL: string;
}
