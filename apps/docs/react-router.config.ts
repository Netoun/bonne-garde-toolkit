import type { Config } from "@react-router/dev/config";

import { listNav } from "./app/nav";

export default {
  ssr: false,
  async prerender() {
    const sections = await listNav();
    return ["/", ...sections.flatMap((section) => section.links.map((link) => link.href))];
  },
} satisfies Config;
