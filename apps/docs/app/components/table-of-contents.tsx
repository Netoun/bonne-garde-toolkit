import { cn } from "@acme/ui/lib/utils";

import type { Heading } from "../lib/headings";

export function TableOfContents({ headings }: { headings: Heading[] }) {
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 font-medium">On this page</p>
      <ul className="flex flex-col gap-2 border-l">
        {headings.map(({ depth, text, id }, index) => (
          <li key={`${id}-${index}`}>
            <a
              href={`#${id}`}
              className={cn(
                "block text-muted-foreground transition-colors hover:text-foreground",
                depth === 3 ? "pl-7" : "pl-3",
              )}
            >
              {text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
