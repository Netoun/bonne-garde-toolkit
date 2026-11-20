import { Progress } from "@acme/ui/components/progress";

export default function ProgressDemo() {
  return (
    <div className="flex w-full max-w-sm flex-col gap-4">
      <Progress value={33} />
      <Progress value={66} />
      <Progress value={100} />
    </div>
  );
}
