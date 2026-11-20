import { Badge } from "@acme/ui/components/badge";
import { Button } from "@acme/ui/components/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@acme/ui/components/card";
import { Link, useLoaderData } from "react-router";

import logoMarkUrl from "../../../../assets/logo/logo-mark-blue.svg?url";
import { CodeBlock } from "../components/code-block";
import { highlight } from "../lib/highlight";

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

export async function loader() {
  const html = await highlight(QUICK_START, "bash");
  return { quickStart: { code: QUICK_START, html, label: "Quick start" } };
}

export default function Home() {
  const { quickStart } = useLoaderData<typeof loader>();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-16 sm:px-6 sm:py-24">
      <section className="flex flex-col items-center gap-6 text-center">
        <img src={logoMarkUrl} alt="" className="size-14" width={56} height={56} aria-hidden />
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
            Bonne Garde
          </h1>
          <p className="text-lg text-muted-foreground sm:text-xl">
            A shadcn-inspired toolkit: an empty base template, a CLI and a registry of UI components
            and full-stack modules you install into your own project.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button render={<Link to="/docs/introduction" />}>Get started</Button>
          <Button render={<Link to="/components/button" />} variant="outline">
            Browse components
          </Button>
        </div>
      </section>

      <section className="mx-auto w-full max-w-2xl">
        <CodeBlock {...quickStart} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLKIT_CARDS.map((card) => (
          <Link
            key={card.href}
            to={card.href}
            className="group block rounded-xl outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Card className="h-full transition-colors group-hover:bg-muted/30" animated={false}>
              <CardHeader className="gap-3">
                <Badge variant="secondary" className="w-fit">
                  {card.badge}
                </Badge>
                <CardTitle className="text-base">{card.title}</CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
