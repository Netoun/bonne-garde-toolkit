import { afterAll, describe, expect, it } from "vite-plus/test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite-plus";
import { faviconLinks } from "./favicon-links";
import { favicons } from "./vite-favicons";

const scratch: string[] = [];
afterAll(() => Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true }))));

/** What the plugin puts in the build of a site of one empty page, and the manifest it holds. */
async function emitted(): Promise<{ files: string[]; manifest: string }> {
  const root = await mkdtemp(join(tmpdir(), "config-favicon-links-"));
  scratch.push(root);
  await writeFile(join(root, "index.html"), "<!doctype html><title>site</title>");
  await build({ root, plugins: [favicons()], logLevel: "silent", configFile: false });
  const files = (await readdir(join(root, "dist"))).filter((name) => name !== "index.html");
  return { files, manifest: await readFile(join(root, "dist/site.webmanifest"), "utf8") };
}

/** The file name of each icon a web manifest names by root URL. */
function manifestFiles(manifest: string): string[] {
  const parsed: unknown = JSON.parse(manifest);
  const icons =
    typeof parsed === "object" &&
    parsed !== null &&
    "icons" in parsed &&
    Array.isArray(parsed.icons)
      ? parsed.icons
      : [];
  return icons.flatMap((icon: unknown) =>
    typeof icon === "object" && icon !== null && "src" in icon && typeof icon.src === "string"
      ? [icon.src.replace(/^\//, "")]
      : [],
  );
}

describe("faviconLinks, what a page links to name the favicons the plugin emits", () => {
  it("names only root URLs of files the plugin emits", async () => {
    const { files } = await emitted();

    expect(faviconLinks.length).toBeGreaterThan(0);
    for (const { href } of faviconLinks) {
      expect(href.startsWith("/")).toBe(true);
      expect(files).toContain(href.slice(1));
    }
  });

  it("leaves no emitted file unnamed: each is linked or is an icon the manifest names", async () => {
    const { files, manifest } = await emitted();

    const named = [...faviconLinks.map(({ href }) => href.slice(1)), ...manifestFiles(manifest)];

    expect(files.sort()).toEqual([...new Set(named)].sort());
  });

  it("links the manifest once", () => {
    expect(faviconLinks.filter(({ rel }) => rel === "manifest")).toEqual([
      { rel: "manifest", href: "/site.webmanifest" },
    ]);
  });
});
