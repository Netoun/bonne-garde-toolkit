import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { useLoaderData } from "react-router";
import remarkGfm from "remark-gfm";

import { CodeBlock } from "../components/code-block";
import { resolveGuideLink } from "../lib/guide-links";
import { listPublishedSources } from "../lib/guide-source";
import { highlight } from "../lib/highlight";

const FENCE = /^```([\w-]*)[^\n]*\n([\s\S]*?)\n```$/gm;
const LINK = /\]\(([^)\s]+)/g;

const blockKey = (lang: string, code: string) => `${lang}\n${code}`;

async function highlightBlock(code: string, lang: string) {
  try {
    return await highlight(code, lang || "text");
  } catch {
    return highlight(code, "text");
  }
}

export async function loader({ request }: { request: Request }) {
  // Prerendering also requests `<route>.data`; the guide and the ADR routes share this loader.
  const pathname = new URL(request.url).pathname.replace(/\.data$/, "").replace(/(.)\/$/, "$1");
  const source = listPublishedSources().find((candidate) => candidate.href === pathname);
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

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? textOf(child.props.children)
        : String(child),
    )
    .join("");
}

/** GitHub's anchor rule, so the guides' own `#anchor` links keep working. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

function heading(Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") {
  return function Heading({ children }: ComponentProps<typeof Tag>) {
    return (
      <Tag id={slugify(textOf(children))} className="scroll-mt-20">
        {children}
      </Tag>
    );
  };
}

export default function Guide() {
  const { markdown, links, highlighted } = useLoaderData<typeof loader>();

  const components: Components = {
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    h5: heading("h5"),
    h6: heading("h6"),
    a: ({ href, children }) => <a href={href ? (links[href] ?? href) : href}>{children}</a>,
    pre: ({ children }) => {
      const code = Children.toArray(children)[0];
      if (!isValidElement<{ className?: string; children?: ReactNode }>(code)) {
        return <pre>{children}</pre>;
      }
      const lang = /language-([\w-]+)/.exec(code.props.className ?? "")?.[1] ?? "";
      const text = textOf(code.props.children).replace(/\n$/, "");
      const html = highlighted[blockKey(lang, text)];
      return html ? <CodeBlock code={text} html={html} /> : <pre>{text}</pre>;
    },
  };

  return (
    <article className="prose-docs mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </Markdown>
    </article>
  );
}
