import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { writePreviews } from "./preview";

const TEMPLATES = ["verify-email", "reset-password", "invitation", "welcome"];
const LOCALES = ["en", "fr"];

let outDir: string;

beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "email-preview-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("writePreviews", () => {
  test("writes one html and one text file per template and locale, and an index", async () => {
    const written = await writePreviews(outDir);

    const expected = TEMPLATES.flatMap((template) =>
      LOCALES.flatMap((locale) => [`${template}.${locale}.html`, `${template}.${locale}.txt`]),
    );
    expect((await readdir(outDir)).toSorted()).toEqual([...expected, "index.html"].toSorted());
    expect(written.map((path) => path.slice(outDir.length + 1)).toSorted()).toEqual(
      [...expected, "index.html"].toSorted(),
    );
  });

  test("renders each locale's own words into its files", async () => {
    await writePreviews(outDir);

    const en = await readFile(join(outDir, "verify-email.en.html"), "utf8");
    const fr = await readFile(join(outDir, "verify-email.fr.html"), "utf8");
    const frText = await readFile(join(outDir, "verify-email.fr.txt"), "utf8");
    expect(en).toContain('lang="en"');
    expect(fr).toContain('lang="fr"');
    expect(frText).not.toMatch(/<\/?[a-z!][^>]*>/i);
    expect(frText).toContain("https://");
  });

  test("links every html file from index.html", async () => {
    await writePreviews(outDir);

    const index = await readFile(join(outDir, "index.html"), "utf8");
    const htmlFiles = (await readdir(outDir)).filter(
      (name) => name.endsWith(".html") && name !== "index.html",
    );
    expect(htmlFiles).toHaveLength(TEMPLATES.length * LOCALES.length);
    for (const name of htmlFiles) {
      expect(index).toContain(`href="${name}"`);
    }
  });
});
