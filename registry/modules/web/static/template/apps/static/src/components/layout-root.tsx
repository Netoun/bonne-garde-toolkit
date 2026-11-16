export function LayoutRoot({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background text-foreground flex flex-col">{children}</div>;
}
