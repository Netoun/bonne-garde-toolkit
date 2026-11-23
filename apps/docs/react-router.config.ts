import type { Config } from "@react-router/dev/config";

import { join } from "node:path";

import { basePath, hoistBasePathOutput } from "./base-path";
import { writeLlmsArtifacts } from "./app/lib/llms";
import { writeCachedNav } from "./app/lib/nav-cache";
import { listNav } from "./app/nav.server";

export default {
  basename: basePath,
  ssr: false,
  async buildEnd({ reactRouterConfig }) {
    const clientDir = join(reactRouterConfig.buildDirectory, "client");
    hoistBasePathOutput(clientDir, basePath);
    await writeLlmsArtifacts(clientDir, basePath);
  },
  async prerender() {
    const sections = await listNav();
    writeCachedNav(sections);
    return ["/", ...sections.flatMap((section) => section.links.map((link) => link.href))];
  },
} satisfies Config;
