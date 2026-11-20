import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * The path the site is served under: `actions/configure-pages` reports it as `/<repo>` for a project
 * page and as an empty string on a custom domain. Always starts and ends with `/`, `/` by default.
 */
export function normalizeBasePath(raw: string | undefined): string {
  const segments = (raw ?? "").split("/").filter(Boolean);
  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

export const basePath = normalizeBasePath(process.env.DOCS_BASE_PATH);

/**
 * React Router writes every prerendered file under the base path (`build/client/<base>/docs/…`),
 * but GitHub Pages serves the artifact root at that path. Move them up to the root, over the SPA
 * fallback it wrote there.
 */
export function hoistBasePathOutput(clientDir: string, base: string): void {
  const [first, ...rest] = base.split("/").filter(Boolean);
  if (first === undefined) return;
  const nested = join(clientDir, first, ...rest);
  if (!existsSync(nested)) return;
  cpSync(nested, clientDir, { recursive: true, force: true });
  rmSync(join(clientDir, first), { recursive: true, force: true });
}
