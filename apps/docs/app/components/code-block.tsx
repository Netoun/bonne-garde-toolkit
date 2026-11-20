import { Button } from "@acme/ui/components/button";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

type CodeBlockProps = {
  code: string;
  html: string;
  label?: string;
};

export function CodeBlock({ code, html, label }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <figure className="relative overflow-hidden rounded-lg border">
      {label ? (
        <figcaption className="border-b bg-muted px-4 py-2 text-sm font-medium">{label}</figcaption>
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
          className="absolute top-2 right-2"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy"}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </div>
    </figure>
  );
}
