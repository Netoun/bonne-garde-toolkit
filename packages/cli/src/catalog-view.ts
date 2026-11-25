/**
 * What `list`, `search` and `view` print on a terminal: the catalog grouped by kind, names bold,
 * descriptions dimmed and cut to the terminal width. A pipe and `--json` never come here.
 */
import { styleText } from "node:util";
import type { RegistryItem, RegistryModule } from "@bonne-garde/registry";
import type { ProjectManifest } from "@bonne-garde/schema";
import { loadManifest } from "./manifest-file";

const bold = (text: string) => styleText("bold", text);
const dim = (text: string) => styleText("dim", text);
const green = (text: string) => styleText("green", text);

/** Item kinds in the order they are shown; any other `registry:<kind>` follows, by its own name. */
const ITEM_GROUPS: [type: string, title: string][] = [
  ["registry:ui", "UI"],
  ["registry:block", "Blocks"],
  ["registry:hook", "Hooks"],
  ["registry:lib", "Libraries"],
];

const MARK = "✓ ";
const NO_MARK = "  ";

/** What a project already holds, as `list` names it: an item by name, a module as `<category>/<id>`. */
export function installedNames(manifest: ProjectManifest | null): Set<string> {
  const names = new Set<string>();
  if (manifest === null) {
    return names;
  }
  for (const name of Object.keys(manifest.items)) {
    names.add(name);
  }
  for (const [category, records] of Object.entries(manifest.modules)) {
    for (const { id } of records ?? []) {
      names.add(`${category}/${id}`);
    }
  }
  return names;
}

/** What the project in `cwd` holds; a directory that is not a project holds nothing, and gets no marks. */
export async function readInstalled(
  cwd: string,
): Promise<{ installed: Set<string>; hasProject: boolean }> {
  const manifest = await loadManifest(cwd).then(
    (read) => read.manifest,
    () => null,
  );
  return { installed: installedNames(manifest), hasProject: manifest !== null };
}

type Row = { name: string; description: string | undefined };

/** Rows of one group: the names in one column, the description cut with `…` so the line fits. */
function rows(entries: Row[], indent: number, installed: ReadonlySet<string>, width: number) {
  const nameWidth = Math.max(...entries.map(({ name }) => name.length));
  return entries.map(({ name, description }) => {
    const prefix = " ".repeat(indent) + (installed.has(name) ? green(MARK) : NO_MARK);
    const room = width - indent - MARK.length - nameWidth - 2;
    const text = description ?? "";
    const cut =
      room <= 1 ? "" : text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text;
    return `${prefix}${bold(name.padEnd(nameWidth))}${cut === "" ? "" : `  ${dim(cut)}`}`.trimEnd();
  });
}

function itemGroups(items: RegistryItem[]): [title: string, items: RegistryItem[]][] {
  const known = new Set(ITEM_GROUPS.map(([type]) => type));
  const others = [...new Set(items.map((item) => item.type).filter((type) => !known.has(type)))];
  const kinds = [
    ...ITEM_GROUPS,
    ...others.sort().map((type): [string, string] => [type, type.replace(/^registry:/, "")]),
  ];
  return kinds
    .map(([type, title]): [string, RegistryItem[]] => [title, items.filter((i) => i.type === type)])
    .filter(([, group]) => group.length > 0);
}

export type CatalogView = {
  items: RegistryItem[];
  modules: RegistryModule[];
  installed: ReadonlySet<string>;
  /** Whether a `bg.json` was read: only then does the legend explain the marks. */
  hasProject: boolean;
  width: number;
  /** The command that runs the CLI, as `cliRunner()` names it. */
  runner: string;
};

export function renderCatalog({
  items,
  modules,
  installed,
  hasProject,
  width,
  runner,
}: CatalogView) {
  const lines: string[] = [];
  for (const [title, group] of itemGroups(items)) {
    lines.push(bold(`${title} (${group.length})`));
    lines.push(
      ...rows(
        group.map(({ name, description }) => ({ name, description })),
        2,
        installed,
        width,
      ),
    );
  }
  if (modules.length > 0) {
    lines.push(bold("Modules"));
    const categories = [...new Set(modules.map(({ manifest }) => manifest.category))];
    for (const category of categories) {
      lines.push(`  ${bold(category)}`);
      lines.push(
        ...rows(
          modules
            .filter(({ manifest }) => manifest.category === category)
            .map(({ manifest }) => ({
              name: `${manifest.category}/${manifest.id}`,
              description: manifest.description,
            })),
          4,
          installed,
          width,
        ),
      );
    }
  }
  const footer = [
    hasProject ? `${green("✓")} ${dim("installed")}` : null,
    dim(`${items.length + modules.length} entries`),
    dim(`${runner} add <name>`),
  ].filter((part) => part !== null);
  lines.push("", footer.join(dim(" · ")));
  return lines.join("\n");
}

export function renderNoMatch(query: string): string {
  return `No match for "${query}"`;
}

/** One item: what it is, how to install it, the files it writes, what it depends on. */
export function renderItem(
  item: RegistryItem,
  { rootDir, runner, installed }: { rootDir: string; runner: string; installed: boolean },
): string {
  const relative = (path: string) =>
    path.startsWith(`${rootDir}/`) ? path.slice(rootDir.length + 1) : path;
  const lines = [
    `${bold(item.name)}  ${dim(item.type)}${installed ? `  ${green("✓ installed")}` : ""}`,
  ];
  if (item.description !== undefined) {
    lines.push(item.description);
  }
  lines.push("", `${dim("Install")}  ${runner} add ${item.name}`);
  const files = item.files ?? [];
  if (files.length > 0) {
    lines.push("", bold("Files"));
    for (const file of files) {
      lines.push(
        `  ${relative(file.path)}${file.target === undefined ? "" : dim(` → ${file.target}`)}`,
      );
    }
  }
  const depends: [string, string[] | undefined][] = [
    ["Needs", item.registryDependencies],
    ["Packages", item.dependencies],
    ["Dev packages", item.devDependencies],
  ];
  const present = depends.filter(([, names]) => names !== undefined && names.length > 0);
  if (present.length > 0) {
    lines.push("", bold("Dependencies"));
    for (const [label, names] of present) {
      lines.push(`  ${dim(label.padEnd(12))}${(names ?? []).join(", ")}`);
    }
  }
  return lines.join("\n");
}
