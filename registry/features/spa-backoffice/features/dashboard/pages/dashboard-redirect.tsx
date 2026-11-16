import { useEffect } from "react";
import { useNavigate } from "react-router";
import { branding } from "@acme/config";

export function meta() {
  return [
    { title: `${branding.displayName} — Backoffice` },
    { name: "description", content: `Backoffice ${branding.displayName}` },
  ];
}

export default function Index() {
  const navigate = useNavigate();

  useEffect(() => {
    // Redirect to dashboard in SPA mode
    navigate("/dashboard", { replace: true });
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-muted-foreground">Redirection...</p>
    </div>
  );
}
