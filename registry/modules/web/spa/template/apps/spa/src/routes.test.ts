import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import { describe, expect, it } from "vite-plus/test";
import routes from "./routes";

/** Every entry of the composed table, children included. */
function flatten(entries: readonly RouteConfigEntry[]): RouteConfigEntry[] {
  return entries.flatMap((entry) => [entry, ...flatten(entry.children ?? [])]);
}

const all = flatten(routes);

describe("the route table composed from the shell and the features' fragments", () => {
  it("has one index route: the shell's home page, or the feature that replaced it", () => {
    expect(routes.filter((entry) => entry.index === true)).toHaveLength(1);
  });

  it("names only files that exist, so a fragment cannot be left pointing at a deleted page", () => {
    // `import.meta.dirname`, not a URL: the jsdom environment replaces the global `URL`.
    const missing = all.filter((entry) => !existsSync(join(import.meta.dirname, entry.file)));
    expect(missing.map((entry) => entry.file)).toEqual([]);
  });

  it("declares no file twice: two routes of one file share an id, which React Router refuses", () => {
    const files = all.map((entry) => entry.file);
    expect(files.filter((file, at) => files.indexOf(file) !== at)).toEqual([]);
  });
});
