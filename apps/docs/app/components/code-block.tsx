import { Button } from "@acme/ui/components/button";
import { Copy } from "lucide-react";

type CodeBlockProps = {
  code: string;
  html: string;
  label?: string;
};

export function CodeBlock({ code, html, label }: CodeBlockProps) {
  async function copy() {
    await navigator.clipboard.writeText(code);
  }

  return (
    <figure className="relative overflow-hidden rounded-lg border">
      {label ? (
        <figcaption className="border-b bg-muted px-4 py-2 text-sm font-medium">{label}</figcaption>
      ) : null}
      <div className="relative">
        <div
          className="overflow-x-auto text-sm [&_.shiki]:!m-0 [&_.shiki]:rounded-none [&_.shiki]:!bg-transparent [&_.shiki]:p-4"
          // Shiki HTML is produced server-side from trusted source strings in loaders.
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          onClick={copy}
          aria-label="Copy"
        >
          <Copy />
        </Button>
      </div>
    </figure>
  );
}
