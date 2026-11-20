export type Heading = { depth: 2 | 3; text: string; id: string };

const FENCE = /^```[\s\S]*?^```/gm;
const HEADING = /^(#{2,3}) +(.+?) *#*$/gm;

/** GitHub's anchor rule, so the guides' own `#anchor` links keep working. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

/** Visible text of an inline markdown heading: links, emphasis and code lose their markers. */
function plainText(inline: string): string {
  return inline
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .trim();
}

/** The h2 and h3 of a markdown document, outside fenced code, in reading order. */
export function extractHeadings(markdown: string): Heading[] {
  return [...markdown.replace(FENCE, "").matchAll(HEADING)].map(([, hashes = "", raw = ""]) => {
    const text = plainText(raw);
    return { depth: hashes.length === 2 ? 2 : 3, text, id: slugify(text) };
  });
}
