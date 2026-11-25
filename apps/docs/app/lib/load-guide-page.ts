import { resolveGuideLink } from "./guide-links";
import { listPublishedSources } from "./guide-source";
import { highlight } from "./highlight";

const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)\n```$/gm;
const LINK = /\]\(([^)\s]+)/g;

export const blockKey = (lang: string, code: string) => `${lang}\n${code}`;

async function highlightBlock(code: string, lang: string) {
  try {
    return await highlight(code, lang || "text");
  } catch {
    return highlight(code, "text");
  }
}

export async function loadGuidePage({ request }: { request: Request }) {
  // Prerendering also requests `<route>.data`; the guide and the ADR routes share this loader.
  // The request URL carries the base path the site is served under, which the hrefs do not.
  const pathname = new URL(request.url).pathname.replace(/\.data$/, "").replace(/(.)\/$/, "$1");
  const source = listPublishedSources().find((candidate) => pathname.endsWith(candidate.href));
  if (!source) throw new Response("Not found", { status: 404 });

  const links = Object.fromEntries(
    [...source.markdown.matchAll(LINK)].map(([, href = ""]) => [
      href,
      resolveGuideLink(href, source.file),
    ]),
  );
  const highlighted = await Promise.all(
    [...source.markdown.matchAll(FENCE)].map(async ([, lang = "", code = ""]) => [
      blockKey(lang, code),
      await highlightBlock(code, lang),
    ]),
  );

  return {
    title: source.title,
    markdown: source.markdown,
    links,
    highlighted: Object.fromEntries(highlighted),
  };
}
