import { Button } from "@acme/ui/components/button";
import { Link } from "react-router";

const SECTIONS = [
  { title: "Guides", href: "/docs/introduction" },
  { title: "Components", href: "/components/button" },
  { title: "Modules", href: "/modules/ui/shadcn" },
];

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-24">
      <h1 className="text-4xl font-bold tracking-tight">Bonne Garde</h1>
      <p className="text-lg text-muted-foreground">
        A shadcn-inspired toolkit: an empty base template, a CLI and a registry of UI components and
        full-stack modules you install into your own project.
      </p>
      <pre className="overflow-x-auto rounded-lg border bg-muted p-4 text-sm">
        {`bunx bonne-garde create my-app\ncd my-app\nbunx bonne-garde add ui/shadcn button`}
      </pre>
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
