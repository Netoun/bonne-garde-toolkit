import { afterAll, describe, expect, it } from "vite-plus/test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, createServer, type InlineConfig } from "vite-plus";
import { favicons } from "./vite-favicons";

const scratch: string[] = [];
afterAll(() => Promise.all(scratch.map((dir) => rm(dir, { recursive: true, force: true }))));

async function put(root: string, path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

/** A site of one empty page, and the directory it would serve favicons from. */
async function site(): Promise<{ root: string; icons: string }> {
  const root = await mkdtemp(join(tmpdir(), "config-favicons-"));
  scratch.push(root);
  await put(root, "index.html", "<!doctype html><title>site</title>");
  // 0xff is a byte UTF-8 text cannot hold: a file read as text would not come out identical.
  await put(root, "icons/icon.ico", Uint8Array.from([0x00, 0x00, 0x01, 0x00, 0xff]));
  await put(root, "icons/site.webmanifest", '{"name":"My App"}\n');
  return { root, icons: join(root, "icons") };
}

const quiet = { logLevel: "silent", configFile: false } satisfies InlineConfig;

describe("favicons, the Vite plugin that serves a package's favicons from the site root", () => {
  it("emits every file of its directory into the build, under its own name and byte for byte", async () => {
    const { root, icons } = await site();

    await build({ ...quiet, root, plugins: [favicons(icons)] });

    for (const name of ["icon.ico", "site.webmanifest"]) {
      expect(await readFile(join(root, "dist", name))).toEqual(await readFile(join(icons, name)));
    }
  });

  it("emits the favicons of config/branding by default", async () => {
    const { root } = await site();

    await build({ ...quiet, root, plugins: [favicons()] });

    const built = await readdir(join(root, "dist"));
    for (const name of ["favicon.svg", "favicon.ico", "site.webmanifest"]) {
      expect(built).toContain(name);
    }
    expect(await readFile(join(root, "dist/site.webmanifest"), "utf8")).toBe(
      await readFile(join(import.meta.dirname, "../assets/favicons/site.webmanifest"), "utf8"),
    );
  });

  it("keeps the files of the app's own public directory, which Vite takes only one of", async () => {
    const { root, icons } = await site();
    await put(root, "public/robots.txt", "User-agent: *\n");

    await build({ ...quiet, root, plugins: [favicons(icons)] });

    expect(await readFile(join(root, "dist/robots.txt"), "utf8")).toBe("User-agent: *\n");
    expect(await readdir(join(root, "dist"))).toContain("icon.ico");
  });

  it("serves them from the site root in development, with their content type", async () => {
    const { root, icons } = await site();
    const server = await createServer({
      ...quiet,
      root,
      plugins: [favicons(icons)],
      // No page fallback: what the plugin does not answer is a 404 here.
      appType: "custom",
      server: { host: "127.0.0.1" },
    });
    await server.listen();
    try {
      const origin = server.resolvedUrls?.local[0] ?? "";

      const icon = await fetch(`${origin}icon.ico`);
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toBe("image/x-icon");
      expect(new Uint8Array(await icon.arrayBuffer())).toEqual(
        new Uint8Array(await readFile(join(icons, "icon.ico"))),
      );

      const manifest = await fetch(`${origin}site.webmanifest`);
      expect(manifest.headers.get("content-type")).toBe("application/manifest+json");
      expect(await manifest.text()).toBe('{"name":"My App"}\n');

      // A path that is not one of the favicons is left to the rest of the server.
      expect((await fetch(`${origin}missing.png`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});
