import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type { NavLink } from "../nav";

const CARD =
  "group flex flex-1 flex-col gap-1 rounded-lg border px-4 py-3 transition-colors hover:bg-muted/50";

export function DocPager({
  previous,
  next,
}: {
  previous: NavLink | undefined;
  next: NavLink | undefined;
}) {
  if (!previous && !next) return null;
  return (
    <nav aria-label="Previous and next pages" className="mt-12 flex gap-4">
      {previous ? (
        <Link to={previous.href} className={CARD}>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <ChevronLeft className="size-3" aria-hidden />
            Previous
          </span>
          <span className="font-medium">{previous.title}</span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
      {next ? (
        <Link to={next.href} className={`${CARD} items-end text-right`}>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            Next
            <ChevronRight className="size-3" aria-hidden />
          </span>
          <span className="font-medium">{next.title}</span>
        </Link>
      ) : (
        <span className="flex-1" />
      )}
    </nav>
  );
}
