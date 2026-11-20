import { Checkbox } from "@acme/ui/components/checkbox";
import { Input } from "@acme/ui/components/input";
import { Label } from "@acme/ui/components/label";

export default function LabelDemo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="username">Username</Label>
        <Input id="username" defaultValue="shadcn" />
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="label-demo-terms" />
        <Label htmlFor="label-demo-terms">I agree to the terms</Label>
      </div>
    </div>
  );
}
