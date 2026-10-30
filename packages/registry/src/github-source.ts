export const GITHUB_RAW_BASE = "https://raw.githubusercontent.com";

/** Requests in flight at once against a github source: enough to hide latency, few enough to be polite. */
export const FETCH_CONCURRENCY = 8;

export type GithubOptions = {
  /** Where files are read from. Defaults to GitHub raw; a test points it at a local server. */
  baseUrl?: string;
  /** Sent as `Authorization: Bearer <token>`: lifts the rate limit, and reads a private repository. */
  token?: string;
};

/** A source that could not be read: unreachable, refused, or answering something that is not a file. */
export class RegistrySourceError extends Error {
  override name = "RegistrySourceError";
}

/**
 * GitHub answers 404, not 401, to a bad token, public repository or not: a stale `GITHUB_TOKEN` in
 * the environment makes a registry that exists look as if it does not.
 */
export const STALE_TOKEN_HINT =
  "this request carried a token; a stale or wrong GITHUB_TOKEN also makes GitHub answer 404 for a public repository, so unset it to read anonymously";

/** The source answered 404 for a path: the file is not there at that ref. */
export class RegistryFileNotFoundError extends RegistrySourceError {
  override name = "RegistryFileNotFoundError";
  constructor(
    readonly path: string,
    readonly label: string,
    readonly url: string,
    authenticated: boolean,
  ) {
    super(
      `${path} not found in ${label} (404 at ${url})${authenticated ? `; ${STALE_TOKEN_HINT}` : ""}`,
    );
  }
}

export type GithubRegistry = {
  /** `github:owner/repo@ref`, as an error message names the source. */
  label: string;
  ref: string;
  /** Whether each request carries a token. */
  authenticated: boolean;
  /** The text of a repo-relative path (`registry/ui/button.tsx`) at the ref. */
  read(path: string): Promise<string>;
};

const encodePath = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

export function githubRegistry(
  ownerRepo: string,
  ref: string,
  options: GithubOptions = {},
): GithubRegistry {
  const base = (options.baseUrl ?? GITHUB_RAW_BASE).replace(/\/+$/, "");
  const label = `github:${ownerRepo}@${ref}`;
  const headers: Record<string, string> =
    options.token === undefined ? {} : { Authorization: `Bearer ${options.token}` };

  return {
    label,
    ref,
    authenticated: options.token !== undefined,
    async read(path) {
      // A branch name keeps its slashes: raw resolves `feat/x` as the ref, not as a directory.
      const url = `${base}/${ownerRepo}/${encodePath(ref)}/${encodePath(path)}`;
      let response: Response;
      try {
        response = await fetch(url, { headers });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new RegistrySourceError(`cannot reach ${url}: ${reason}`);
      }
      if (response.status === 404) {
        await response.body?.cancel();
        throw new RegistryFileNotFoundError(path, label, url, options.token !== undefined);
      }
      if (!response.ok) {
        await response.body?.cancel();
        const hint =
          response.status === 403 || response.status === 429
            ? " (rate limited or refused: set GITHUB_TOKEN to authenticate)"
            : "";
        throw new RegistrySourceError(`${url} answered ${response.status}${hint}`);
      }
      return response.text();
    },
  };
}

/**
 * The ref a github source is read at, decided once for the index and every file. Spec 070 pins a
 * registry to the platform tag, so a source with no `@ref` reads `v<platform.version>`: never a
 * branch, and never HEAD for the index and a tag for the files.
 */
export function resolveRef(
  ownerRepo: string,
  ref: string | undefined,
  platformVersion: string | undefined,
): string {
  if (ref !== undefined) {
    return ref;
  }
  const version = platformVersion?.replace(/^v/, "");
  if (version === undefined || version === "" || version === "0.0.0") {
    throw new Error(
      `github:${ownerRepo} names no @ref, and bg.json carries no platform version to derive the tag from: pin a ref (github:${ownerRepo}@v<version>)`,
    );
  }
  return `v${version}`;
}
