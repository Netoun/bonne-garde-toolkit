/**
 * oxlint plugin `structure`, rule `structure/route-modules`. Same file in every repo; the mode is
 * the rule option: `["error", { "mode": "pages" }]` or `["error", { "mode": "flat" }]`.
 *
 * A route module is a file declared in an app's `src/routes.ts`, or in a feature's fragment
 * `src/features/<f>/routes.ts`, which the app's `routes.ts` composes. Both declare paths relative
 * to `src`. Rules:
 *   1. Role suffix: a module with children ends in `-layout.tsx`; a leaf ends in `-page.tsx`,
 *      or `-redirect.tsx` when it only redirects.
 *   2. Feature prefix: its name starts with its feature (`features/game/…/game-room-page.tsx`).
 *   3. One place: mode "pages" → `features/<f>/pages/`; mode "flat" → the feature folder itself.
 *      Nothing else lives there: components, hooks, helpers and types go to subfolders. The
 *      fragment `features/<f>/routes.ts` is the one other file allowed at a feature root.
 *   4. Reserved names: `-page` / `-layout` / `-redirect` only for files declared in a `routes.ts`.
 * Resource routes (`.ts`, no component) are exempt from rules 1 and 2.
 *
 * Rules 1–3 are reported on the path string in the `routes.ts` that declares it; rules 3–4 for
 * unrouted files are reported on the file itself.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const NON_ROUTE_FOLDERS = ["components", "hooks", "lib", "utils", "store", "assets", "data"];
const ROUTE_HELPERS = ["route", "layout", "index"];
const ROUTE_PATH = /["'`](features\/[^"'`]+\.tsx?)["'`]/g;
const FRAGMENT = /^features\/[^/]+\/routes\.ts$/;

const isTest = (file) => /\.(test|spec)\.tsx?$/.test(file);

function isRouteFolder(dir, mode) {
  const segments = dir.split("/");
  if (mode === "pages") return segments.length > 2 && segments.at(-1) === "pages";
  return segments.length >= 2 && !NON_ROUTE_FOLDERS.includes(segments.at(-1) ?? "");
}

function featureNames(dir, mode) {
  const segments = dir.split("/").slice(1);
  return mode === "pages" && segments.at(-1) === "pages" ? segments.slice(0, -1) : segments;
}

const routeHome = (mode) =>
  mode === "pages" ? "features/<feature>/pages/" : "features/<feature>/";

/** Problems of one route module declared in routes.ts. */
function routeModuleProblems(file, hasChildren, mode) {
  if (!file.startsWith("features/")) return [`route modules live under ${routeHome(mode)}`];
  const problems = [];
  const name = basename(file);
  const dir = dirname(file);
  if (!isRouteFolder(dir, mode)) problems.push(`route modules live in ${routeHome(mode)}`);
  if (name.endsWith(".ts")) return problems;
  if (hasChildren && !name.endsWith("-layout.tsx")) {
    problems.push("has child routes, so it is a layout → name it *-layout.tsx");
  }
  if (!hasChildren && !/-(page|redirect)\.tsx$/.test(name)) {
    problems.push("leaf route → name it *-page.tsx (or *-redirect.tsx if it only redirects)");
  }
  const features = featureNames(dir, mode);
  if (!features.some((feature) => name.startsWith(`${feature}-`))) {
    problems.push(`start the name with its feature (${features.at(-1)}-…)`);
  }
  return problems;
}

/** Problems of a file under features/ that routes.ts does not declare. */
function unroutedFileProblem(file, routed, mode) {
  const dir = dirname(file);
  if (/-(page|layout|redirect)\.tsx$/.test(file)) {
    return "-page/-layout/-redirect are reserved for files declared in routes.ts → rename it, or route it";
  }
  const moveIt = "move it to a subfolder (components/, hooks/, lib/…)";
  if (mode === "pages") {
    if (dir.split("/").length === 2) return `no loose file at a feature root → ${moveIt}`;
    if (isRouteFolder(dir, mode))
      return `only route modules live in ${routeHome(mode)} → ${moveIt}`;
    return null;
  }
  const routeFolders = new Set([...routed].map((route) => dirname(route)));
  if (routeFolders.has(dir)) return `only route modules live in ${routeHome(mode)} → ${moveIt}`;
  return null;
}

/** The app's routes.ts and each feature's fragment, features/<f>/routes.ts. */
function routeConfigs(src) {
  const features = join(src, "features");
  const fragments = readdirSync(features, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(features, entry.name, "routes.ts"))
    .filter((fragment) => existsSync(fragment));
  return [join(src, "routes.ts"), ...fragments];
}

/** Paths declared in the app's routes.ts and in the fragments, ignoring commented-out routes. */
function routedFiles(src) {
  const routed = new Set();
  for (const config of routeConfigs(src)) {
    const code = readFileSync(config, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const match of code.matchAll(ROUTE_PATH)) routed.add(match[1] ?? "");
  }
  return routed;
}

const isNonEmptyArray = (node) => node?.type === "ArrayExpression" && node.elements.length > 0;

const routeModules = {
  meta: {
    type: "problem",
    docs: {
      description: "Route modules are named by role, prefixed by feature, and live in one place.",
    },
    schema: [
      {
        type: "object",
        properties: { mode: { enum: ["pages", "flat"] } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const mode = context.options[0]?.mode ?? "pages";
    const filename = String(context.filename).replaceAll("\\", "/");

    const at = filename.lastIndexOf("/features/");
    const file = at === -1 ? null : filename.slice(at + 1);

    if (basename(filename) === "routes.ts" && (file === null || FRAGMENT.test(file))) {
      let isReactRouterConfig = false;
      return {
        ImportDeclaration(node) {
          if (node.source.value === "@react-router/dev/routes") isReactRouterConfig = true;
        },
        CallExpression(node) {
          if (!isReactRouterConfig || node.callee.type !== "Identifier") return;
          const helper = node.callee.name;
          if (!ROUTE_HELPERS.includes(helper)) return;
          const fileNode = helper === "route" ? node.arguments[1] : node.arguments[0];
          if (fileNode?.type !== "Literal" || typeof fileNode.value !== "string") return;
          const hasChildren = node.arguments.slice(1).some(isNonEmptyArray);
          for (const problem of routeModuleProblems(fileNode.value, hasChildren, mode)) {
            context.report({ node: fileNode, message: `${fileNode.value}: ${problem}` });
          }
        },
      };
    }

    if (file === null || isTest(filename)) return {};
    const src = filename.slice(0, at);
    if (!existsSync(join(src, "routes.ts"))) return {};
    return {
      Program(node) {
        const routed = routedFiles(src);
        if (routed.has(file)) return;
        const problem = unroutedFileProblem(file, routed, mode);
        if (problem) context.report({ node, message: `${file}: ${problem}` });
      },
    };
  },
};

export default {
  meta: { name: "structure" },
  rules: { "route-modules": routeModules },
};
