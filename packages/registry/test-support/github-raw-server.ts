import { resolve, sep } from "node:path";

export type GithubRawServer = {
  /** What a `GithubOptions.baseUrl` takes: the stand-in for `https://raw.githubusercontent.com`. */
  baseUrl: string;
  /** Every path asked for under `<owner>/<repo>/<ref>/registry/`, in order; anything else as sent. */
  requested: string[];
  /** The `Authorization` header of each request, in order (`null` when absent). */
  authorization: (string | null)[];
  /** Registry-relative paths that answer 404 although the file is there. */
  missing: Set<string>;
  stop(): void;
};

/**
 * A real HTTP server that lays `registryDir` out the way GitHub raw lays out a repository:
 * `/<owner>/<repo>/<ref>/registry/<path>`. The ref may hold slashes, as a branch name does. Any other
 * repo, ref or path is a 404, so a wrong ref fails the way it does on GitHub.
 */
export function serveGithubRaw(options: {
  registryDir: string;
  ownerRepo: string;
  ref: string;
}): GithubRawServer {
  const root = resolve(options.registryDir);
  const prefix = `/${options.ownerRepo}/${options.ref}/registry/`;
  const state = {
    requested: [] as string[],
    authorization: [] as (string | null)[],
    missing: new Set<string>(),
  };

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      state.authorization.push(request.headers.get("authorization"));
      if (!pathname.startsWith(prefix)) {
        state.requested.push(pathname);
        return new Response("404: Not Found", { status: 404 });
      }
      const relative = pathname.slice(prefix.length);
      state.requested.push(relative);
      const file = resolve(root, relative);
      if (state.missing.has(relative) || !file.startsWith(root + sep)) {
        return new Response("404: Not Found", { status: 404 });
      }
      const body = Bun.file(file);
      return (await body.exists())
        ? new Response(body)
        : new Response("404: Not Found", { status: 404 });
    },
  });

  return {
    baseUrl: server.url.origin,
    ...state,
    stop: () => void server.stop(true),
  };
}
