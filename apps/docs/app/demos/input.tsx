import { Input } from "@acme/ui/components/input";
import { Label } from "@acme/ui/components/label";

export default function InputDemo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" placeholder="you@example.com" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="file">File</Label>
        <Input id="file" type="file" />
      </div>
      <Input disabled placeholder="Disabled" />
    </div>
  );
}
