import { join } from "node:path";

import type { RegistryFile, RegistryItem } from "./registry-types";

export function itemFileText(item: string, path: string, bytes: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(
      `item ${item} ships ${path}, which is not valid UTF-8: items are text-only, and a binary file belongs to a module`,
    );
  }
}

/** Where `bg add` writes an item's file: its `target`, or the place its type implies. */
export function itemFileTarget(item: RegistryItem, file: RegistryFile): string {
  if (file.target !== undefined) {
    return file.target;
  }
  const base = file.path.split("/").pop() ?? file.path;
  if (item.type === "registry:ui" || file.path.includes("/ui/")) {
    return join("packages/ui/src/components", base);
  }
  if (base === "utils.ts") {
    return join("packages/ui/src/lib", base);
  }
  return base;
}
