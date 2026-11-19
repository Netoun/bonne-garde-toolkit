import type { Config } from "@react-router/dev/config";

import { writeCachedNav } from "./app/lib/nav-cache";
import { warmCatalog } from "./app/lib/registry-warm";
import { listNav } from "./app/nav";

export default {
  ssr: false,
  async prerender() {
    await warmCatalog();
    const sections = await listNav();
    writeCachedNav(sections);
    return ["/", ...sections.flatMap((section) => section.links.map((link) => link.href))];
  },
} satisfies Config;
