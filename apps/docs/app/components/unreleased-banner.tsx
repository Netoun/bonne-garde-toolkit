/**
 * The `main` build is served under `<base>/next/`, the latest release at `<base>/`. Returns the
 * release's root for a next build, `null` for the release build.
 */
function releasedDocsHref(base: string): string | null {
  const segments = base.split("/").filter(Boolean);
  if (segments.at(-1) !== "next") return null;
  return `/${segments
    .slice(0, -1)
    .map((segment) => `${segment}/`)
    .join("")}`;
}

export function UnreleasedBanner() {
  const releasedHref = releasedDocsHref(import.meta.env.BASE_URL);
  if (releasedHref === null) return null;
  return (
    <aside
      role="note"
      aria-label="Unreleased version"
      className="border-b border-amber-500/40 bg-amber-500/10 px-6 py-2 text-sm"
    >
      <strong>Unreleased version.</strong> These docs follow <code>main</code>: the published
      bonne-garde CLI may not install what they show yet. Read the{" "}
      {/* A plain link: the router would prefix it with this build's base. */}
      <a href={releasedHref} className="font-medium underline underline-offset-4">
        released docs
      </a>
      .
    </aside>
  );
}
