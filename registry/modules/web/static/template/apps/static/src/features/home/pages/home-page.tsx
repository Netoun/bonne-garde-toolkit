import { Outlet } from "react-router";
import { branding } from "{{SCOPE}}/config";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground gap-4 p-8">
      <h1 className="font-heading text-4xl font-bold tracking-tight">{branding.displayName}</h1>
      <p className="text-muted-foreground text-lg">Site vitrine — Bientôt disponible</p>
      <Outlet />
    </main>
  );
}
