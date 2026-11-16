import type { PackageDependenciesPatch } from "./patch-plan";
import { itemFileTarget, PlanError } from "./resolve-plan";
import type { RegistryItem } from "./types";

/**
 * An item's npm dependencies (spec 030). An entry written `name@version` is added to the
 * `package.json` of the app or package the item's files land in, as `package.dependencies` adds a
 * module's (060), so the same writer puts it where the formatter sorts it and the same regions record
 * it, owned by the item. A bare `name` says what the files import and is written by nobody: the
 * module that owns the package already pins it (the `ui` module installs the union of its items').
 */

type Entry = { name: string; version: string };

/** `name`, `name@version` and `@scope/name@version`: a leading `@` is a scope, not a version. */
function splitSpec(item: RegistryItem, map: string, spec: string): Entry | null {
  const at = spec.lastIndexOf("@");
  if (at <= 0) {
    return null;
  }
  const version = spec.slice(at + 1);
  if (version.length === 0) {
    throw new PlanError(`${item.name} declares ${map} entry ${spec} with no version`);
  }
  return { name: spec.slice(0, at), version };
}

/** The item's name for a package of the project: `@acme/auth` is the project's `auth`, whatever its scope. */
const renderScope = (name: string, scope: string): string =>
  name.startsWith("@acme/") ? `${scope}${name.slice("@acme".length)}` : name;

/** The workspaces the item's files land in: `apps/<id>` or `packages/<id>`. */
function workspacesOf(item: RegistryItem): { workspaces: string[]; outside: string[] } {
  const workspaces = new Set<string>();
  const outside: string[] = [];
  for (const file of item.files ?? []) {
    const target = itemFileTarget(item, file);
    const workspace = /^((?:apps|packages)\/[^/]+)\//.exec(target)?.[1];
    if (workspace === undefined) {
      outside.push(target);
    } else {
      workspaces.add(workspace);
    }
  }
  return { workspaces: [...workspaces].sort(), outside };
}

function entriesOf(
  item: RegistryItem,
  map: "dependencies" | "devDependencies",
  scope: string,
): Record<string, string> {
  const written: Record<string, string> = {};
  for (const spec of item[map] ?? []) {
    const entry = splitSpec(item, map, spec);
    if (entry === null) {
      continue;
    }
    const name = renderScope(entry.name, scope);
    if (Object.hasOwn(written, name)) {
      throw new PlanError(`${item.name} declares ${name} twice in ${map}`);
    }
    written[name] = entry.version;
  }
  return written;
}

/** The one `package.dependencies` patch an item plans, or none when it declares no `name@version`. */
export function itemDependencyPatches(
  item: RegistryItem,
  scope: string,
): PackageDependenciesPatch[] {
  const dependencies = entriesOf(item, "dependencies", scope);
  const devDependencies = entriesOf(item, "devDependencies", scope);
  const names = [...Object.keys(dependencies), ...Object.keys(devDependencies)];
  if (names.length === 0) {
    return [];
  }
  const both = Object.keys(dependencies).find((name) => Object.hasOwn(devDependencies, name));
  if (both !== undefined) {
    throw new PlanError(`${item.name} declares ${both} in dependencies and in devDependencies`);
  }
  const declared =
    [...(item.dependencies ?? []), ...(item.devDependencies ?? [])].find(
      (spec) => splitSpec(item, "dependencies", spec) !== null,
    ) ?? "";
  const { workspaces, outside } = workspacesOf(item);
  if (workspaces.length === 0) {
    throw new PlanError(
      `${item.name} declares ${declared} but its files land in no app or package (${outside.join(", ") || "it has none"}): an entry with a version goes into the package.json of one`,
    );
  }
  if (workspaces.length > 1) {
    throw new PlanError(
      `${item.name} declares ${declared} but its files land in ${workspaces.length} workspaces (${workspaces.join(", ")}): an entry with a version goes into one package.json`,
    );
  }
  return [
    {
      type: "package.dependencies",
      file: `${workspaces[0]}/package.json`,
      dependencies,
      devDependencies,
    },
  ];
}
