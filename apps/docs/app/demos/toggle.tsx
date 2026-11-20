import { Bold, Italic, Underline } from "lucide-react";

import { Toggle } from "@acme/ui/components/toggle";

export default function ToggleDemo() {
  return (
    <div className="flex flex-wrap gap-2">
      <Toggle aria-label="Toggle bold" defaultPressed>
        <Bold />
      </Toggle>
      <Toggle aria-label="Toggle italic" variant="outline">
        <Italic />
      </Toggle>
      <Toggle aria-label="Toggle underline" size="sm" variant="outline">
        <Underline />
      </Toggle>
    </div>
  );
}
