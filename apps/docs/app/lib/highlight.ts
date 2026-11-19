import { createHighlighter, type BundledLanguage, type Highlighter } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

let highlighter: Highlighter | undefined;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: ["bash", "shell", "sh", "typescript", "tsx", "json", "diff"],
      ...(import.meta.env.VITEST ? { engine: createJavaScriptRegexEngine() } : {}),
    });
  }
  return highlighter;
}

export async function highlight(code: string, lang: string): Promise<string> {
  const h = await getHighlighter();
  const loaded = h.getLoadedLanguages();
  if (!loaded.includes(lang as BundledLanguage)) {
    await h.loadLanguage(lang as BundledLanguage);
  }
  return h.codeToHtml(code, {
    lang,
    themes: {
      light: "github-light",
      dark: "github-dark",
    },
  });
}
