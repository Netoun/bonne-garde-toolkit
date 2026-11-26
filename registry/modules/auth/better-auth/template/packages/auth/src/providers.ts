/** The social providers Better Auth ships, by the id that is also its callback path. */
const SOCIAL_LABELS = {
  github: "GitHub",
  gitlab: "GitLab",
  discord: "Discord",
  google: "Google",
  microsoft: "Microsoft",
} as const;

export type SocialProviderId = keyof typeof SOCIAL_LABELS;

type Credentials = { clientId: string; clientSecret: string };

/** A sign-in provider the environment declares. */
export type SignInProvider =
  | {
      id: SocialProviderId;
      kind: "social";
      label: string;
      /** Whether a person with no account here can create one by signing in with it. */
      autoSignup: boolean;
      options: Credentials;
    }
  | {
      id: string;
      kind: "oidc";
      label: string;
      autoSignup: boolean;
      options: Credentials & { issuer: string };
    };

const OIDC_ID = /^[a-z0-9-]+$/;

/** A key's value, or `undefined` when it is unset or blank: `.env.example` lists every key with no value. */
function text(env: Record<string, unknown>, key: string): string | undefined {
  const value = env[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function required(env: Record<string, unknown>, key: string): string {
  const value = text(env, key);
  if (value === undefined) {
    throw new Error(`Missing sign-in provider variable: ${key}`);
  }
  return value;
}

function autoSignup(env: Record<string, unknown>, key: string): boolean {
  const value = text(env, key);
  if (value === undefined) return false;
  if (value !== "true" && value !== "false") {
    throw new Error(`Invalid sign-in provider variable: ${key} must be "true" or "false"`);
  }
  return value === "true";
}

/**
 * The sign-in providers an environment declares, as `readRuntimeEnv()` returns it: the social ones
 * first (`<ID>_CLIENT_ID` and `<ID>_CLIENT_SECRET`), then the ones `OIDC_PROVIDERS` lists. Pure, and
 * strict: a half-declared provider, a malformed id or an `*_AUTO_SIGNUP` that is not `true` or `false`
 * throws an error that names the key, so a typo never leaves a provider silently off.
 */
export function readProviders(env: Record<string, unknown>): SignInProvider[] {
  const providers: SignInProvider[] = [];

  for (const id of Object.keys(SOCIAL_LABELS) as SocialProviderId[]) {
    const prefix = id.toUpperCase();
    if (
      text(env, `${prefix}_CLIENT_ID`) === undefined &&
      text(env, `${prefix}_CLIENT_SECRET`) === undefined
    ) {
      continue;
    }
    providers.push({
      id,
      kind: "social",
      label: SOCIAL_LABELS[id],
      autoSignup: autoSignup(env, `${prefix}_AUTO_SIGNUP`),
      options: {
        clientId: required(env, `${prefix}_CLIENT_ID`),
        clientSecret: required(env, `${prefix}_CLIENT_SECRET`),
      },
    });
  }

  const listed = text(env, "OIDC_PROVIDERS");
  const ids =
    listed === undefined || listed.trim() === "" ? [] : listed.split(",").map((id) => id.trim());
  const seen = new Set<string>();
  for (const id of ids) {
    if (!OIDC_ID.test(id)) {
      throw new Error(`Invalid id in OIDC_PROVIDERS: "${id}" must match [a-z0-9-]+`);
    }
    // Both kinds are served at `/callback/<id>` or `/oauth2/callback/<id>` and are stored as an
    // account's `providerId`: one name for two providers would merge their accounts.
    if (seen.has(id) || id in SOCIAL_LABELS) {
      throw new Error(`Duplicate provider id in OIDC_PROVIDERS: ${id}`);
    }
    seen.add(id);
  }
  for (const id of ids) {
    const prefix = `OIDC_${id.toUpperCase().replaceAll("-", "_")}`;
    providers.push({
      id,
      kind: "oidc",
      label: text(env, `${prefix}_NAME`)?.trim() ?? id,
      autoSignup: autoSignup(env, `${prefix}_AUTO_SIGNUP`),
      options: {
        issuer: required(env, `${prefix}_ISSUER`),
        clientId: required(env, `${prefix}_CLIENT_ID`),
        clientSecret: required(env, `${prefix}_CLIENT_SECRET`),
      },
    });
  }
  return providers;
}
