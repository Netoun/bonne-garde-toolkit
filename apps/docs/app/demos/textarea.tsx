import { Label } from "@acme/ui/components/label";
import { Textarea } from "@acme/ui/components/textarea";

export default function TextareaDemo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Label htmlFor="message">Message</Label>
      <Textarea id="message" placeholder="Type your message here." />
    </div>
  );
}
