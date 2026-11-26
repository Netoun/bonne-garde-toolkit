import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { buildServiceWorker, spaFallback } from "./build-service-worker";

const SCRIPT_TAG = '<script src="/register-sw.js" defer></script>';
const dirs: string[] = [];

/** A client build as `react-router build` leaves it: an index, a nested page and a hashed asset. */
async function clientBuild(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-build-"));
  dirs.push(dir);
  const all: Record<string, string> = {
    "index.html": "<!DOCTYPE html><html><head><title>app</title></head><body>app</body></html>",
    "docs/page.html": "<html><head></head><body>page</body></html>",
    "assets/app-abc123.js": "console.log('app');",
    "site.webmanifest": '{"name":"app"}',
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
  return dir;
}

const occurrences = (text: string, part: string) => text.split(part).length - 1;

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("buildServiceWorker", () => {
  it("writes sw.js, which precaches the hashed asset and the manifest", async () => {
    const dir = await clientBuild();

    await buildServiceWorker(dir);

    const worker = await readFile(join(dir, "sw.js"), "utf8");
    expect(worker).toContain("assets/app-abc123.js");
    expect(worker).toContain("site.webmanifest");
    expect(worker).toContain("index.html");
  });

  it("registers /sw.js on load from register-sw.js, which the worker precaches too", async () => {
    const dir = await clientBuild();

    await buildServiceWorker(dir);

    const register = await readFile(join(dir, "register-sw.js"), "utf8");
    expect(register).toContain("serviceWorker");
    expect(register).toContain('"load"');
    expect(register).toContain("/sw.js");
    expect(await readFile(join(dir, "sw.js"), "utf8")).toContain("register-sw.js");
  });

  it("puts the registration script once in every HTML file, before the head closes", async () => {
    const dir = await clientBuild();

    await buildServiceWorker(dir);

    for (const page of ["index.html", "docs/page.html"]) {
      const html = await readFile(join(dir, page), "utf8");
      expect(occurrences(html, SCRIPT_TAG)).toBe(1);
      expect(html.indexOf(SCRIPT_TAG)).toBeLessThan(html.indexOf("</head>"));
    }
  });

  it("leaves the HTML identical when it runs a second time", async () => {
    const dir = await clientBuild();
    await buildServiceWorker(dir);
    const first = await readFile(join(dir, "index.html"), "utf8");

    await buildServiceWorker(dir);

    expect(await readFile(join(dir, "index.html"), "utf8")).toBe(first);
    expect(occurrences(first, SCRIPT_TAG)).toBe(1);
  });

  it("precaches the HTML as it is after the injection", async () => {
    const dir = await clientBuild();

    await buildServiceWorker(dir);

    // The revision workbox writes is the hash of the file: precaching a page without the script
    // would serve the offline shell with no registration.
    const worker = await readFile(join(dir, "sw.js"), "utf8");
    const { createHash } = await import("node:crypto");
    const html = await readFile(join(dir, "index.html"), "utf8");
    const revision = createHash("md5").update(html).digest("hex");
    expect(worker).toContain(revision);
  });

  it("answers navigations with a fallback page that exists in the build", async () => {
    const dir = await clientBuild();

    await buildServiceWorker(dir);

    const worker = await readFile(join(dir, "sw.js"), "utf8");
    expect(worker).toContain('createHandlerBoundToURL("/index.html")');
    expect((await stat(join(dir, "index.html"))).isFile()).toBe(true);
  });
});

describe("spaFallback", () => {
  it("is index.html, which `react-router build` writes with `ssr: false`", async () => {
    expect(await spaFallback(await clientBuild())).toBe("/index.html");
  });

  it("is __spa-fallback.html when the build prerenders and has no index.html", async () => {
    const dir = await clientBuild({ "__spa-fallback.html": "<html><head></head></html>" });
    await rm(join(dir, "index.html"));

    expect(await spaFallback(dir)).toBe("/__spa-fallback.html");
  });

  it("fails when the directory has neither, rather than precaching a fallback that is not there", async () => {
    const dir = await clientBuild();
    await rm(join(dir, "index.html"));

    await expect(spaFallback(dir)).rejects.toThrow(/index\.html/);
    await expect(buildServiceWorker(dir)).rejects.toThrow(/index\.html/);
  });
});
