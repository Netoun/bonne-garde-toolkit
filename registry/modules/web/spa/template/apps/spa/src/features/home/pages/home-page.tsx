import { branding } from "{{SCOPE}}/config";

export default function HomePage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">{branding.displayName}</h1>
    </main>
  );
}
