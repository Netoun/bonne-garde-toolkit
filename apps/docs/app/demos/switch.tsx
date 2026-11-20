import { Label } from "@acme/ui/components/label";
import { Switch } from "@acme/ui/components/switch";

export default function SwitchDemo() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Switch id="airplane" defaultChecked />
        <Label htmlFor="airplane">Airplane mode</Label>
      </div>
      <div className="flex items-center gap-2">
        <Switch id="compact" size="sm" />
        <Label htmlFor="compact">Compact switch</Label>
      </div>
    </div>
  );
}
