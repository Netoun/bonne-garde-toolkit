import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite-plus";

/** The favicons of this package, next to `src`. */
const FAVICONS = join(dirname(fileURLToPath(import.meta.url)), "../assets/favicons");

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

/**
 * Serves the favicons and the web manifest of this package from the site root, so that the
 * manifest's icons are files of the build under the names it gives them.
 *
 * Vite takes one `publicDir`, so an app that has a `public/` of its own (a `robots.txt`) cannot also
 * point it here. This adds the files to the build as assets instead, in the client build only, and
 * answers them in development. An app that has no other static file may set `publicDir` to the
 * directory and skip the plugin.
 */
export function favicons(directory: string = FAVICONS): Plugin {
  return {
    name: "config:favicons",
    async configureServer(server) {
      const names = new Set(await readdir(directory));
      server.middlewares.use((request, response, next) => {
        const name = new URL(request.url ?? "/", "http://localhost").pathname.slice(1);
        if (!names.has(name)) {
          next();
          return;
        }
        readFile(join(directory, name)).then((body) => {
          response.setHeader(
            "content-type",
            CONTENT_TYPES[extname(name)] ?? "application/octet-stream",
          );
          response.end(body);
        }, next);
      });
    },
    async generateBundle() {
      if (this.environment.name !== "client") {
        return;
      }
      for (const name of await readdir(directory)) {
        this.emitFile({
          type: "asset",
          fileName: name,
          source: await readFile(join(directory, name)),
        });
      }
    },
  };
}
