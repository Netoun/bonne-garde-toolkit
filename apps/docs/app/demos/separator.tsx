import { Separator } from "@acme/ui/components/separator";

export default function SeparatorDemo() {
  return (
    <div className="w-full max-w-md">
      <div className="space-y-1">
        <h4 className="text-sm font-medium leading-none">Bonne Garde</h4>
        <p className="text-sm text-muted-foreground">Documentation components toolkit.</p>
      </div>
      <Separator className="my-4" />
      <div className="flex h-5 items-center gap-4 text-sm">
        <span>Docs</span>
        <Separator orientation="vertical" />
        <span>Registry</span>
        <Separator orientation="vertical" />
        <span>CLI</span>
      </div>
    </div>
  );
}
