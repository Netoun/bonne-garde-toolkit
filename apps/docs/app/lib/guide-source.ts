import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Repository root. Docs commands (`build`, `test`) run from `apps/docs`; plain Node, no Vite-only API, so `react-router.config.ts` can import it. */
const repoRoot = `${resolve(process.cwd(), "../..")}/`;

/** The user-facing guides, in sidebar order. Contributor-only files are not published. */
const GUIDE_FILES = [
  "CONCEPTS",
  "CLI",
  "MODULES",
  "MANIFEST",
  "RELEASE",
  "DESIGN",
  "ENVIRONMENT",
] as const;

export type GuideSource = {
  /** Repository path of the markdown file, e.g. `docs/CONCEPTS.md`. */
  file: string;
  /** Site route, e.g. `/docs/concepts`. */
  href: string;
  /** The file's first `#` heading. */
  title: string;
  markdown: string;
};

function readSource(file: string, href: string): GuideSource {
  const markdown = readFileSync(`${repoRoot}${file}`, "utf8");
  const title = /^# (.+)$/m.exec(markdown)?.[1];
  if (!title) throw new Error(`${file} has no "#" heading`);
  return { file, href, title, markdown };
}

export function listGuideSources(): GuideSource[] {
  return GUIDE_FILES.map((name) => readSource(`docs/${name}.md`, `/docs/${name.toLowerCase()}`));
}

export function listAdrSources(): GuideSource[] {
  return readdirSync(`${repoRoot}docs/adr`)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => readSource(`docs/adr/${file}`, `/docs/adr/${file.slice(0, -3)}`));
}

export function listPublishedSources(): GuideSource[] {
  return [...listGuideSources(), ...listAdrSources()];
}

export function repositoryVersion(): string {
  const { version } = JSON.parse(readFileSync(`${repoRoot}package.json`, "utf8")) as {
    version: string;
  };
  return version;
}
