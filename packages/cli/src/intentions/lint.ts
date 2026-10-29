import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export class IntentionsLintError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.name = "IntentionsLintError";
    this.errors = errors;
  }
}

export type IntentionMeta = {
  id: string;
  domain: string;
  classification: string;
  requires: string[];
  file: string;
  order: number;
  slug: string;
};

export type LintRelease = {
  version: string;
  intentions: string[];
};

export type LintResult = {
  releases: LintRelease[];
  errors: string[];
};

const RELEASE_DIR_RE = /^v(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;
const FILE_RE = /^(\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const CLASSIFICATIONS = new Set(["informational", "migration", "breaking-manual"]);

function parseFrontmatter(source: string): Record<string, unknown> {
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    throw new Error("missing frontmatter");
  }
  const end = source.indexOf("\n---", 4);
  if (end === -1) {
    throw new Error("unclosed frontmatter");
  }
  const block = source.slice(4, end).replace(/\r/g, "");
  const result: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let listMode = false;

  for (const line of block.split("\n")) {
    if (listMode && currentKey) {
      const listItem = line.match(/^\s+-\s+(.+)$/);
      if (listItem) {
        const list = result[currentKey];
        if (Array.isArray(list)) {
          list.push(listItem[1]!.trim());
        }
        continue;
      }
      listMode = false;
      currentKey = null;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1]!;
    const raw = match[2]!;
    if (raw === "" || raw === "|" || raw === ">") {
      result[key] = [];
      currentKey = key;
      listMode = true;
      continue;
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      const inner = raw.slice(1, -1).trim();
      result[key] = inner ? inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")) : [];
      continue;
    }
    result[key] = raw.replace(/^["']|["']$/g, "");
    currentKey = key;
    listMode = false;
  }

  return result;
}

function asString(value: unknown, field: string, file: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${file}: ${field} must be a non-empty string`);
  }
  return value;
}

function asStringList(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new Error("requires must be a list of strings");
  }
  return value as string[];
}

async function loadIntention(
  releaseVersion: string,
  absFile: string,
  fileName: string,
): Promise<IntentionMeta> {
  const fileMatch = FILE_RE.exec(fileName);
  if (!fileMatch) {
    throw new Error(`${fileName}: must be named NN-slug.md (zero-padded order + kebab slug)`);
  }
  const order = Number(fileMatch[1]);
  const slug = fileMatch[2]!;
  const source = await readFile(absFile, "utf8");
  let fm: Record<string, unknown>;
  try {
    fm = parseFrontmatter(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${fileName}: ${message}`);
  }

  const id = asString(fm.id, "id", fileName);
  const domain = asString(fm.domain, "domain", fileName);
  const classification = asString(fm.classification, "classification", fileName);
  let requires: string[];
  try {
    requires = asStringList(fm.requires);
  } catch {
    throw new Error(`${fileName}: requires must be a list of strings`);
  }

  const expectedId = `v${releaseVersion}/${slug}`;
  if (id !== expectedId) {
    throw new Error(`${fileName}: id must be ${expectedId}, got ${id}`);
  }
  if (!CLASSIFICATIONS.has(classification)) {
    throw new Error(
      `${fileName}: classification must be one of ${[...CLASSIFICATIONS].join(", ")}`,
    );
  }

  return { id, domain, classification, requires, file: fileName, order, slug };
}

export async function lintIntentions(migrationsDir: string): Promise<LintResult> {
  const errors: string[] = [];
  const releases: LintRelease[] = [];

  let entries: string[];
  try {
    entries = await readdir(migrationsDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new IntentionsLintError([`cannot read migrations dir: ${message}`]);
  }

  const releaseDirs = entries
    .filter((name) => RELEASE_DIR_RE.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const dirName of releaseDirs) {
    const version = RELEASE_DIR_RE.exec(dirName)?.[1];
    if (!version) continue;
    const releasePath = join(migrationsDir, dirName);
    const files = await readdir(releasePath);
    const intentionFiles = files
      .filter((f) => f.endsWith(".md") && f !== "README.md" && f !== "TEMPLATE.md")
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (!files.includes("README.md")) {
      errors.push(`${dirName}: missing README.md`);
    }

    const intentions: IntentionMeta[] = [];
    for (const fileName of intentionFiles) {
      try {
        intentions.push(await loadIntention(version, join(releasePath, fileName), fileName));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    const seenOrders = new Set<number>();
    const byId = new Map<string, IntentionMeta>();
    for (const intention of intentions) {
      if (seenOrders.has(intention.order)) {
        errors.push(
          `${dirName}: duplicate order prefix ${String(intention.order).padStart(2, "0")}`,
        );
      }
      seenOrders.add(intention.order);
      if (byId.has(intention.id)) {
        errors.push(`${dirName}: duplicate id ${intention.id}`);
      }
      byId.set(intention.id, intention);
    }

    for (const intention of intentions) {
      for (const dep of intention.requires) {
        const depMeta = byId.get(dep);
        if (!depMeta) {
          errors.push(`${intention.file}: requires ${dep} but it is not defined in ${dirName}`);
          continue;
        }
        if (depMeta.order >= intention.order) {
          errors.push(
            `${intention.file}: requires ${dep} which does not appear earlier in execution order`,
          );
        }
      }
    }

    if (files.includes("README.md")) {
      const readme = await readFile(join(releasePath, "README.md"), "utf8");
      for (const intention of intentions) {
        if (!readme.includes(intention.id)) {
          errors.push(
            `${dirName}/README.md: missing intention id ${intention.id} (run intentions sync)`,
          );
        }
      }
    }

    releases.push({
      version,
      intentions: intentions.map((i) => i.id),
    });
  }

  if (errors.length > 0) {
    throw new IntentionsLintError(errors);
  }

  return { releases, errors: [] };
}
