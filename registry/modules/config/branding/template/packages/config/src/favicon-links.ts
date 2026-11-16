/**
 * A `<link>` that names a favicon or the web manifest. It is the descriptor a React Router `links()`
 * returns, and the props of a `<link>` element.
 */
export interface FaviconLink {
  readonly rel: "icon" | "apple-touch-icon" | "manifest";
  readonly href: string;
  readonly type?: string;
  readonly sizes?: string;
}

/**
 * What a page links to name its favicons and its web manifest, by root URL: the files `favicons()` emits
 * from `vite-favicons.ts`, bar the two Android icons that only the manifest names. This file stays apart
 * from the plugin, which reads the disk, so that a `root.tsx` can import it. `favicon-links.test.ts` holds
 * the two to each other.
 */
export const faviconLinks: readonly FaviconLink[] = [
  { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
  { rel: "icon", type: "image/x-icon", sizes: "48x48", href: "/favicon.ico" },
  { rel: "icon", type: "image/png", sizes: "16x16", href: "/favicon-16x16.png" },
  { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
  { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png" },
  { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];
