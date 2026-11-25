import { Button } from "@acme/ui/components/button";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type CodeBlockProps = {
  code: string;
  html: string;
  label?: string;
};

export function CodeBlock({ code, html, label }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const resetCopyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetCopyTimerRef.current !== null) {
        clearTimeout(resetCopyTimerRef.current);
      }
    };
  }, []);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    if (resetCopyTimerRef.current !== null) {
      clearTimeout(resetCopyTimerRef.current);
    }
    resetCopyTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetCopyTimerRef.current = null;
    }, 2000);
  }

  return (
    <figure className="docs-code relative overflow-hidden rounded-lg border border-docs-code-border bg-docs-code text-docs-code-foreground">
      {label ? (
        <figcaption className="border-b border-docs-code-border px-4 py-2 font-mono text-xs text-docs-code-muted">
          {label}
        </figcaption>
      ) : null}
      <div className="relative">
        <div
          className="max-h-[min(65vh,28rem)] overflow-x-auto overflow-y-auto text-sm [&_.shiki]:!m-0 [&_.shiki]:rounded-none [&_.shiki]:!bg-transparent [&_.shiki]:p-4"
          // Shiki HTML is produced server-side from trusted source strings in loaders.
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2 text-docs-code-muted transition-colors duration-150 hover:bg-docs-code-border hover:text-docs-code-foreground motion-reduce:transition-none"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy"}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </figure>
  );
}
