import { Button } from "@acme/ui/components/button";
import { Link, useLoaderData } from "react-router";

import { CodeBlock } from "../components/code-block";
import { highlight } from "../lib/highlight";

const QUICK_START = `bunx bonne-garde create my-app
cd my-app
bunx bonne-garde add ui/shadcn button`;

const SECTIONS = [
  { title: "Guides", href: "/docs/introduction" },
  { title: "Components", href: "/components/button" },
  { title: "Modules", href: "/modules/ui/shadcn" },
];

export async function loader() {
  const html = await highlight(QUICK_START, "bash");
  return { quickStart: { code: QUICK_START, html, label: "Quick start" } };
}

export default function Home() {
  const { quickStart } = useLoaderData<typeof loader>();

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">Bonne Garde</h1>
      <p className="text-lg text-muted-foreground">
        A shadcn-inspired toolkit: an empty base template, a CLI and a registry of UI components and
        full-stack modules you install into your own project.
      </p>
      <CodeBlock {...quickStart} />
      <nav className="flex flex-wrap gap-3">
        {SECTIONS.map((section) => (
          <Button key={section.href} render={<Link to={section.href} />} variant="outline">
            {section.title}
          </Button>
        ))}
      </nav>
    </main>
  );
}
