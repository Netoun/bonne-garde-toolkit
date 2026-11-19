import { Badge } from "@acme/ui/components/badge";
import { categoryCardinality } from "@bonne-garde/schema";
import { useLoaderData, type LoaderFunctionArgs } from "react-router";

import { CodeBlock } from "../components/code-block";
import { InstallCommand } from "../components/install-command";
import { EnvironmentTable } from "../components/module/environment-table";
import { Requires } from "../components/module/requires";
import { VariantsTable } from "../components/module/variants-table";
import { highlight } from "../lib/highlight";
import { CATEGORY_HOME, mergeEnv } from "../lib/modules";
import { loadModules } from "../lib/registry.server";

export async function loader({ params }: LoaderFunctionArgs) {
  const modules = await loadModules();
  const found = modules.find(
    ({ manifest }) => manifest.category === params.category && manifest.id === params.id,
  );
  if (!found) {
    throw new Response("Module not found", { status: 404 });
  }
  const { manifest } = found;
  const checks = manifest.checks ?? [];
  const checksCode = checks.join("\n");
  return {
    manifest,
    environment: mergeEnv(manifest.variants),
    checks:
      checks.length > 0 ? { code: checksCode, html: await highlight(checksCode, "bash") } : null,
  };
}

export default function Module() {
  const { manifest, environment, checks } = useLoaderData<typeof loader>();

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{manifest.title}</h1>
        <p className="text-muted-foreground">{manifest.description}</p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">{manifest.category}</Badge>
          <span>
            {categoryCardinality(manifest.category)} per project · home{" "}
            <code className="font-mono">{CATEGORY_HOME[manifest.category]}</code>
          </span>
        </p>
      </header>
      <InstallCommand name={`${manifest.category}/${manifest.id}`} />
      <Requires peers={manifest.peers} />
      <VariantsTable variants={manifest.variants} />
      <EnvironmentTable rows={environment} />
      {checks ? (
        <section aria-labelledby="checks" className="flex flex-col gap-3">
          <h2 id="checks" className="text-xl font-semibold">
            Checks
          </h2>
          <CodeBlock {...checks} />
        </section>
      ) : null}
    </article>
  );
}
