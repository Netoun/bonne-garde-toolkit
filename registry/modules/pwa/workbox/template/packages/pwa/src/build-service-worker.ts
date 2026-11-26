import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateSW } from "workbox-build";

const REGISTER_FILE = "register-sw.js";
const SCRIPT_TAG = `<script src="/${REGISTER_FILE}" defer></script>`;

/** Registers the worker once the page has loaded, so the registration never competes with the first render. */
const REGISTER_SCRIPT = `if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => console.warn(error));
  });
}
`;

/** What `react-router build` writes for a SPA: `index.html`, or `__spa-fallback.html` when it prerenders. */
const FALLBACKS = ["index.html", "__spa-fallback.html"] as const;

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (entry) => entry.isFile(),
    () => false,
  );
}

/** The page every navigation is answered with, as a URL: the first of `FALLBACKS` the directory has. */
export async function spaFallback(dir: string): Promise<string> {
  for (const name of FALLBACKS) {
    if (await isFile(join(dir, name))) return `/${name}`;
  }
  throw new Error(
    `No ${FALLBACKS.join(" or ")} in ${dir}: build the web app before the service worker`,
  );
}

async function htmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** `html` with the registration script before `</head>` (at the end without one), unchanged when it has it. */
function withRegistration(html: string): string {
  if (html.includes(SCRIPT_TAG)) return html;
  const head = html.indexOf("</head>");
  return head === -1
    ? `${html}${SCRIPT_TAG}`
    : `${html.slice(0, head)}${SCRIPT_TAG}${html.slice(head)}`;
}

/**
 * Turns the client build in `dir` into an installable, offline-capable one: writes `register-sw.js`,
 * inserts it in every HTML file (once, whatever the number of runs), then generates `sw.js` over the
 * result, so the HTML the worker precaches is the HTML with the script.
 */
export async function buildServiceWorker(dir: string) {
  const navigateFallback = await spaFallback(dir);

  await writeFile(join(dir, REGISTER_FILE), REGISTER_SCRIPT);
  for (const path of await htmlFiles(dir)) {
    const html = await readFile(path, "utf8");
    const registered = withRegistration(html);
    if (registered !== html) await writeFile(path, registered);
  }

  return generateSW({
    globDirectory: dir,
    globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,webmanifest,woff2}"],
    // The previous run's worker and runtime are not part of the app.
    globIgnores: ["sw.js", "workbox-*.js"],
    swDest: join(dir, "sw.js"),
    cleanupOutdatedCaches: true,
    clientsClaim: true,
    skipWaiting: true,
    // Every navigation is answered from the precached shell: assets are hashed and the HTML is
    // revisioned per build, so freshness comes from the worker's update, not a request per page.
    navigateFallback,
  });
}
