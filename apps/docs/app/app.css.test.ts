import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const css = readFileSync("app/app.css", "utf8");

describe("app.css", () => {
  it("imports Urbanist and Faustina variable fonts", () => {
    expect(css).toContain("@fontsource-variable/urbanist");
    expect(css).toContain("@fontsource-variable/faustina");
  });
  // The guide pages render raw markdown elements: Tailwind's preflight strips their styling.
  it.each(["h1", "h2", "h3", "ul", "ol", "table", "th", "td", "blockquote", "code", "a", "hr"])(
    "styles .prose-docs %s",
    (tag) => {
      expect(css).toMatch(new RegExp(`\\.prose-docs\\s+${tag}\\b`));
    },
  );

  it("does not color .prose-docs links with the pale primary", () => {
    const rule = /\.prose-docs a\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).not.toMatch(/(^|\s)text-primary\b/);
    expect(rule).toMatch(/text-foreground/);
  });
});
