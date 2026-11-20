import { readFile } from "node:fs/promises";
import type { LoaderFunctionArgs } from "react-router";

import type { ItemCodeFile } from "../components/item/item-page";
import { itemHasDemo } from "./demos";
import { itemFileTarget, itemFileText } from "./item-file-source";
import { highlight } from "./highlight";
import { itemHref, itemTitle, moduleNeedHref } from "./items";
import { getCatalog } from "./registry";

function langForTarget(target: string): string {
  if (target.endsWith(".tsx")) {
    return "tsx";
  }
  if (target.endsWith(".ts")) {
    return "typescript";
  }
  if (target.endsWith(".json")) {
    return "json";
  }
  return "typescript";
}

export async function loadItemPageData({ params, request }: LoaderFunctionArgs) {
  const name = params.name;
  if (!name) {
    throw new Response("Not Found", { status: 404 });
  }

  const catalog = await getCatalog();
  const item = catalog.items.find((entry) => entry.name === name);
  if (!item) {
    throw new Response("Not Found", { status: 404 });
  }

  const pathname = new URL(request.url).pathname.replace(/\.data$/, "").replace(/(.)\/$/, "$1");
  // The request URL carries the base path the site is served under: only the last two segments count.
  const onBlocks = /\/blocks\/[^/]+$/.test(pathname);
  if (onBlocks !== (item.type === "registry:block")) {
    throw new Response("Not Found", { status: 404 });
  }

  const codeFiles: ItemCodeFile[] = [];
  for (const file of item.files ?? []) {
    const bytes = await readFile(file.path);
    const code = itemFileText(item.name, file.path, bytes);
    const label = itemFileTarget(item, file);
    let html: string;
    try {
      html = await highlight(code, langForTarget(label));
    } catch {
      html = await highlight(code, "text");
    }
    codeFiles.push({ label, code, html });
  }

  const registryItems = new Map(catalog.items.map((entry) => [entry.name, entry]));
  const registryDependencyHrefs = (item.registryDependencies ?? [])
    .map((dep) => {
      const target = registryItems.get(dep);
      return target ? { name: dep, href: itemHref(target) } : null;
    })
    .filter((link): link is { name: string; href: string } => link !== null);

  const needsModules = item.meta?.needsModules;
  const moduleLinks: { label: string; href: string }[] = [];
  if (Array.isArray(needsModules)) {
    for (const entry of needsModules) {
      if (typeof entry !== "string") {
        continue;
      }
      moduleLinks.push({ label: entry, href: moduleNeedHref(catalog, entry) });
    }
  }

  return {
    name: item.name,
    title: itemTitle(item),
    description: item.description,
    hasDemo: itemHasDemo(name),
    codeFiles,
    npmDependencies: [...(item.dependencies ?? []), ...(item.devDependencies ?? [])],
    registryDependencyHrefs,
    moduleLinks,
  };
}
