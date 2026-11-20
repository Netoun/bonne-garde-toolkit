import type { Config } from "@react-router/dev/config";

import { join } from "node:path";

import { basePath, hoistBasePathOutput } from "./base-path";
import { writeCachedNav } from "./app/lib/nav-cache";
import { listNav } from "./app/nav";

export default {
  basename: basePath,
  ssr: false,
  buildEnd({ reactRouterConfig }) {
    hoistBasePathOutput(join(reactRouterConfig.buildDirectory, "client"), basePath);
  },
  async prerender() {
    const sections = await listNav();
    writeCachedNav(sections);
    return ["/", ...sections.flatMap((section) => section.links.map((link) => link.href))];
  },
} satisfies Config;
