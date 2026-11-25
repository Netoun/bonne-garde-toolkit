import { Badge } from "@acme/ui/components/badge";
import { Button } from "@acme/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@acme/ui/components/card";
import { Link, useLoaderData } from "react-router";

import logoMarkUrl from "../../../../assets/logo/logo-mark-blue.svg?url";
import { CodeBlock } from "../components/code-block";
import { highlight } from "../lib/highlight";
import type { Route } from "./+types/home";

const PITCH =
  "A shadcn-inspired toolkit: an empty base template, a CLI and a registry of UI components and full-stack modules you install into your own project.";

const QUICK_START = `bunx bonne-garde create my-app
cd my-app
bunx bonne-garde add ui/shadcn button`;

const TOOLKIT_CARDS = [
  {
    title: "Base template & CLI",
    description: "Scaffold an empty app and add registry pieces with the bonne-garde CLI.",
    href: "/docs/introduction",
    badge: "Start here",
  },
  {
    title: "Components",
    description: "Copy-paste UI primitives from the open registry into your own codebase.",
    href: "/components/button",
    badge: "UI",
  },
  {
    title: "Full-stack modules",
    description: "Wire auth, data and APIs with modules you install like shadcn components.",
    href: "/modules/ui/shadcn",
    badge: "Stack",
  },
] as const;

export const meta: Route.MetaFunction = () => [
  { title: "Bonne Garde" },
  { name: "description", content: PITCH },
];

export async function loader() {
  const html = await highlight(QUICK_START, "bash");
  return { quickStart: { code: QUICK_START, html, label: "Quick start" } };
}

export default function Home() {
  const { quickStart } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-16 sm:px-6 sm:py-24">
      <section className="grid items-center gap-10 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex items-center gap-3">
            <img src={logoMarkUrl} alt="" className="size-8" width={32} height={32} aria-hidden />
            <p className="font-mono text-xs tracking-[0.08em] text-muted-foreground uppercase">
              Base template · CLI · Registry
            </p>
          </div>
          <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
            Bonne Garde
          </h1>
          <p className="max-w-(--docs-measure) text-lg text-muted-foreground">{PITCH}</p>
          <div className="flex flex-wrap items-center gap-3">
            <Button render={<Link to="/docs/introduction" />}>Get started</Button>
            <Button render={<Link to="/components/button" />} variant="outline">
              Browse components
            </Button>
          </div>
        </div>
        <div className="min-w-0">
          <CodeBlock {...quickStart} />
        </div>
      </section>

      <ol aria-label="Toolkit" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLKIT_CARDS.map((card, index) => (
          <li key={card.href}>
            <Link
              to={card.href}
              className="group block h-full rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card
                className="h-full transition-colors duration-150 group-hover:bg-muted/30 motion-reduce:transition-none"
                animated={false}
              >
                <CardHeader className="gap-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary" className="w-fit">
                      {card.badge}
                    </Badge>
                    <span aria-hidden className="font-mono text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <CardTitle className="text-base">{card.title}</CardTitle>
                  <CardDescription>{card.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
