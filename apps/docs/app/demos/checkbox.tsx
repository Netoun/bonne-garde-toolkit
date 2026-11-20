import { Checkbox } from "@acme/ui/components/checkbox";
import { Label } from "@acme/ui/components/label";

export default function CheckboxDemo() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <Checkbox id="terms" defaultChecked />
        <Label htmlFor="terms">Accept terms and conditions</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="newsletter" />
        <Label htmlFor="newsletter">Subscribe to the newsletter</Label>
      </div>
    </div>
  );
}
