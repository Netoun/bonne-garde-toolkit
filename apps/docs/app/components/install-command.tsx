import { Button } from "@acme/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@acme/ui/components/tabs";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

const PACKAGE_MANAGERS = [
  { id: "bun", label: "bun", command: (name: string) => `bunx bonne-garde add ${name}` },
  { id: "pnpm", label: "pnpm", command: (name: string) => `pnpm dlx bonne-garde add ${name}` },
  { id: "npm", label: "npm", command: (name: string) => `npx bonne-garde add ${name}` },
] as const;

type PackageManagerId = (typeof PACKAGE_MANAGERS)[number]["id"];

function commandFor(name: string, tab: PackageManagerId): string {
  const entry = PACKAGE_MANAGERS.find((pm) => pm.id === tab);
  return entry?.command(name) ?? `bunx bonne-garde add ${name}`;
}

export function InstallCommand({ name }: { name: string }) {
  const [tab, setTab] = useState<PackageManagerId>("bun");
  const [copied, setCopied] = useState(false);

  async function copyActive() {
    await navigator.clipboard.writeText(commandFor(name, tab));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Tabs value={tab} onValueChange={(value) => setTab(value as PackageManagerId)}>
      <TabsList>
        {PACKAGE_MANAGERS.map((pm) => (
          <TabsTrigger key={pm.id} value={pm.id}>
            {pm.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {PACKAGE_MANAGERS.map((pm) => (
        <TabsContent key={pm.id} value={pm.id} className="mt-0">
          <div className="relative overflow-hidden rounded-lg border">
            <pre className="overflow-x-auto bg-muted/40 p-4 pr-12 font-mono text-sm">
              {pm.command(name)}
            </pre>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-2 right-2"
              onClick={copyActive}
              aria-label={copied ? "Copied" : "Copy"}
            >
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
