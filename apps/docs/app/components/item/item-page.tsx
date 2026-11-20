import { Badge, badgeVariants } from "@acme/ui/components/badge";
import { cn } from "@acme/ui/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@acme/ui/components/tabs";
import { Link } from "react-router";
import {
  Suspense,
  lazy,
  useMemo,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from "react";

import { CodeBlock } from "../code-block";
import { InstallCommand } from "../install-command";
import { loadItemDemo } from "../../lib/demos";

export type ItemCodeFile = {
  label: string;
  code: string;
  html: string;
};

export type ItemPageProps = {
  name: string;
  title: string;
  description?: string | undefined;
  hasDemo: boolean;
  codeFiles: ItemCodeFile[];
  npmDependencies: string[];
  registryDependencyHrefs: { name: string; href: string }[];
  moduleLinks: { label: string; href: string }[];
};

const lazyDemos = new Map<string, LazyExoticComponent<ComponentType>>();

function ItemDemo({ name }: { name: string }) {
  const Demo = useMemo(() => {
    const cached = lazyDemos.get(name);
    if (cached) {
      return cached;
    }
    const load = loadItemDemo(name);
    if (!load) {
      return null;
    }
    const component = lazy(load);
    lazyDemos.set(name, component);
    return component;
  }, [name]);
  if (!Demo) {
    return null;
  }
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading preview…</p>}>
      <Demo />
    </Suspense>
  );
}

export function ItemPage({
  name,
  title,
  description,
  hasDemo,
  codeFiles,
  npmDependencies,
  registryDependencyHrefs,
  moduleLinks,
}: ItemPageProps) {
  const [tab, setTab] = useState(hasDemo ? "preview" : "code");

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-3">
        <TabsList className="w-fit">
          {hasDemo ? <TabsTrigger value="preview">Preview</TabsTrigger> : null}
          <TabsTrigger value="code">Code</TabsTrigger>
        </TabsList>
        {hasDemo ? (
          <TabsContent value="preview" className="mt-0">
            <section
              role="region"
              aria-label="Preview"
              className="flex min-h-[350px] items-center justify-center rounded-lg border bg-muted/30 p-6"
            >
              <ItemDemo name={name} />
            </section>
          </TabsContent>
        ) : null}
        <TabsContent value="code" className="mt-0 flex flex-col gap-4">
          {codeFiles.map((file) => (
            <CodeBlock key={file.label} code={file.code} html={file.html} label={file.label} />
          ))}
        </TabsContent>
      </Tabs>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Installation</h2>
        <InstallCommand name={name} />
      </section>

      {npmDependencies.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Dependencies</h2>
          <div className="flex flex-wrap gap-2">
            {npmDependencies.map((dep) => (
              <Badge key={dep} variant="secondary">
                {dep}
              </Badge>
            ))}
          </div>
        </section>
      ) : null}

      {registryDependencyHrefs.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Registry dependencies</h2>
          <div className="flex flex-wrap gap-2">
            {registryDependencyHrefs.map((dep) => (
              <Link
                key={dep.name}
                to={dep.href}
                className={cn(badgeVariants({ variant: "outline" }), "hover:bg-muted")}
              >
                {dep.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {moduleLinks.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Required modules</h2>
          <div className="flex flex-wrap gap-2">
            {moduleLinks.map((mod) => (
              <Link
                key={mod.href}
                to={mod.href}
                className={cn(badgeVariants({ variant: "outline" }), "hover:bg-muted")}
              >
                {mod.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
