export type NavSection = { title: string; links: { title: string; href: string }[] };

export type NavLink = NavSection["links"][number];

/** The pages before and after `pathname` in sidebar order, across section boundaries. */
export function adjacentLinks(
  sections: NavSection[],
  pathname: string,
): { previous: NavLink | undefined; next: NavLink | undefined } {
  const path = pathname.replace(/(.)\/$/, "$1");
  const links = sections.flatMap((section) => section.links);
  const index = links.findIndex((link) => link.href === path);
  if (index === -1) return { previous: undefined, next: undefined };
  return { previous: links[index - 1], next: links[index + 1] };
}
