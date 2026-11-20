import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { hoistBasePathOutput, normalizeBasePath } from "../../base-path";

describe("normalizeBasePath", () => {
  it("serves from the root when nothing is set", () => {
    expect(normalizeBasePath(undefined)).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(normalizeBasePath("/")).toBe("/");
  });

  it("starts and ends with a slash", () => {
    expect(normalizeBasePath("/bonne-garde-toolkit")).toBe("/bonne-garde-toolkit/");
    expect(normalizeBasePath("bonne-garde-toolkit")).toBe("/bonne-garde-toolkit/");
    expect(normalizeBasePath("/bonne-garde-toolkit/")).toBe("/bonne-garde-toolkit/");
  });

  it("keeps every segment of the next/ base", () => {
    expect(normalizeBasePath("/bonne-garde-toolkit/next")).toBe("/bonne-garde-toolkit/next/");
    expect(normalizeBasePath("/next")).toBe("/next/");
  });
});

describe("hoistBasePathOutput", () => {
  function clientBuild() {
    const dir = mkdtempSync(join(tmpdir(), "docs-client-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "spa fallback");
    mkdirSync(join(dir, "bonne-garde-toolkit", "docs", "cli"), { recursive: true });
    writeFileSync(join(dir, "bonne-garde-toolkit", "index.html"), "home");
    writeFileSync(join(dir, "bonne-garde-toolkit", "docs", "cli", "index.html"), "cli");
    return dir;
  }

  it("moves the pages React Router wrote under the base path to the site root", () => {
    const dir = clientBuild();

    hoistBasePathOutput(dir, "/bonne-garde-toolkit/");

    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("home");
    expect(readFileSync(join(dir, "docs", "cli", "index.html"), "utf8")).toBe("cli");
    expect(existsSync(join(dir, "assets"))).toBe(true);
    expect(existsSync(join(dir, "bonne-garde-toolkit"))).toBe(false);
  });

  it("moves the pages of a next/ build to the site root", () => {
    const dir = mkdtempSync(join(tmpdir(), "docs-client-"));
    const nested = join(dir, "bonne-garde-toolkit", "next");
    mkdirSync(join(nested, "docs", "cli"), { recursive: true });
    writeFileSync(join(nested, "index.html"), "next home");
    writeFileSync(join(nested, "docs", "cli", "index.html"), "next cli");

    hoistBasePathOutput(dir, "/bonne-garde-toolkit/next/");

    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("next home");
    expect(readFileSync(join(dir, "docs", "cli", "index.html"), "utf8")).toBe("next cli");
    expect(existsSync(join(dir, "bonne-garde-toolkit"))).toBe(false);
  });

  it("leaves a root build alone", () => {
    const dir = clientBuild();

    hoistBasePathOutput(dir, "/");

    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("spa fallback");
    expect(existsSync(join(dir, "bonne-garde-toolkit"))).toBe(true);
  });
});
