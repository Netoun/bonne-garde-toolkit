import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@acme/ui/components/dialog";
import { Input } from "@acme/ui/components/input";
import { cn } from "@acme/ui/lib/utils";

import type { NavSection } from "../nav";

function filterSections(sections: NavSection[], query: string): NavSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;
  return sections
    .map((section) => ({
      ...section,
      links: section.links.filter((link) => link.title.toLowerCase().includes(needle)),
    }))
    .filter((section) => section.links.length > 0);
}

export function SearchDialog({
  sections,
  open,
  onOpenChange,
}: {
  sections: NavSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const filteredSections = useMemo(() => filterSections(sections, query), [sections, query]);
  const flatLinks = useMemo(
    () => filteredSections.flatMap((section) => section.links),
    [filteredSections],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  function goTo(href: string) {
    handleOpenChange(false);
    navigate(href);
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(flatLinks.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
  }

  function handleInputKeyDownEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || flatLinks.length === 0) return;
    event.preventDefault();
    const link = flatLinks[activeIndex] ?? flatLinks[0];
    if (link) goTo(link.href);
  }

  const trimmedQuery = query.trim();
  const showEmpty = trimmedQuery.length > 0 && flatLinks.length === 0;

  let optionIndex = 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-4 overflow-hidden p-0 sm:max-w-lg" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Search documentation</DialogTitle>
        </DialogHeader>
        <div className="border-b px-3 py-2">
          <Input
            ref={inputRef}
            aria-label="Search documentation"
            placeholder="Search documentation…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              handleInputKeyDown(event);
              handleInputKeyDownEnter(event);
            }}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div
          className="max-h-[min(60vh,24rem)] overflow-y-auto px-2 pb-2"
          role="listbox"
          aria-label="Search results"
        >
          {showEmpty ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">No results.</p>
          ) : (
            filteredSections.map((section) => (
              <div key={section.title} className="py-1">
                <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {section.title}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {section.links.map((link) => {
                    const index = optionIndex;
                    optionIndex += 1;
                    const active = index === activeIndex;
                    return (
                      <li key={link.href}>
                        <Link
                          to={link.href}
                          role="option"
                          aria-selected={active}
                          className={cn(
                            "flex w-full rounded-md px-2 py-1.5 text-sm outline-none",
                            active
                              ? "bg-accent text-accent-foreground"
                              : "text-foreground hover:bg-muted/80",
                          )}
                          onClick={(event) => {
                            event.preventDefault();
                            goTo(link.href);
                          }}
                          onMouseEnter={() => setActiveIndex(index)}
                        >
                          {link.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
