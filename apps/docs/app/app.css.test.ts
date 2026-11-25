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

const theme = readFileSync(
  "../../registry/modules/ui/shadcn/template/packages/ui/src/styles/themes/default.css",
  "utf8",
);
const design = readFileSync("DESIGN.md", "utf8");

type Mode = "light" | "dark";

function declarations(source: string, mode: Mode): Map<string, string> {
  const selector = mode === "light" ? ":root" : "\\.dark";
  const tokens = new Map<string, string>();
  for (const block of source.matchAll(new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, "gm"))) {
    for (const [, name, value] of (block[1] ?? "").matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      if (name && value) tokens.set(name, value.trim());
    }
  }
  return tokens;
}

function resolve(token: string, mode: Mode): string {
  // The dark blocks only override; a token they omit keeps its light value.
  const scopes = mode === "dark" ? (["dark", "light"] as const) : (["light"] as const);
  for (const scope of scopes) {
    for (const source of [css, theme]) {
      const value = declarations(source, scope).get(token);
      if (value) return value.startsWith("var(") ? resolve(value.slice(4, -1), mode) : value;
    }
  }
  throw new Error(`${token} is not declared for ${mode}`);
}

/** WCAG relative luminance of an `oklch(L C H)` colour, through OKLab and linear sRGB. */
function luminance(color: string): number {
  const [L = 0, C = 0, H = 0] = (/oklch\(([^)/]+)/.exec(color)?.[1] ?? "")
    .trim()
    .split(/\s+/)
    .map(Number);
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return (
    0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  );
}

function contrast(text: string, background: string): number {
  const [high, low] = [luminance(text), luminance(background)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

const pairs = [
  ...design.matchAll(
    /^\|\s*([^|]+?)\s*\|\s*`(--[\w-]+)`\s*\|\s*`(--[\w-]+)`\s*\|\s*([\d.]+)\s*\|$/gm,
  ),
].map(([, name = "", text = "", background = "", min = "0"]) => ({
  name,
  text,
  background,
  min: Number(min),
}));

describe("docs art direction tokens", () => {
  it("DESIGN.md names the docs code and accent pairs", () => {
    expect(pairs.map(({ text }) => text)).toEqual(
      expect.arrayContaining(["--foreground", "--docs-code-foreground", "--docs-accent"]),
    );
  });

  describe.each(["light", "dark"] as const)("in %s", (mode) => {
    it.each(pairs)("$name ($text on $background) reaches $min:1", ({ text, background, min }) => {
      expect(contrast(resolve(text, mode), resolve(background, mode))).toBeGreaterThanOrEqual(min);
    });
  });

  it("never redeclares a default theme token, so previews keep the default theme", () => {
    const themeTokens = new Set([
      ...declarations(theme, "light").keys(),
      ...declarations(theme, "dark").keys(),
    ]);
    const redeclared = [
      ...declarations(css, "light").keys(),
      ...declarations(css, "dark").keys(),
    ].filter((token) => themeTokens.has(token));
    expect(redeclared).toEqual([]);
  });

  it("underlines .prose-docs links with the docs accent", () => {
    const rule = /\.prose-docs a\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/decoration-docs-accent/);
  });

  it("paints Shiki with its dark palette inside .docs-code in both themes", () => {
    expect(css).toMatch(/\.docs-code \.shiki span[^{]*\{[^}]*var\(--shiki-dark\)/);
    // Shiki paints each line with its theme background: the panel's own colour must show through.
    expect(css).toMatch(
      /html \.docs-code \.shiki span\s*\{\s*background-color: transparent !important;/,
    );
  });
});
