import { type MetaFunction } from "react-router";
import { branding } from "{{SCOPE}}/config";

export const meta: MetaFunction = () => [{ title: branding.displayName }];

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">{branding.displayName}</h1>
        <p className="text-xl text-muted-foreground">Bientôt disponible</p>
      </div>
    </div>
  );
}
