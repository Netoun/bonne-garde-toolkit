import { Outlet, useMatches } from "react-router";
import { motion } from "motion/react";
import { Gem } from "lucide-react";
import { branding } from "@acme/config";
import { ThemeToggle } from "../components/theme-toggle";
import { isAuthLayoutHandle, type AuthLayoutHandle } from "../lib/types";

export default function AuthLayout() {
  const matches = useMatches();

  const handle = matches.reduceRight<AuthLayoutHandle | undefined>(
    (acc, match) => (isAuthLayoutHandle(match.handle) ? match.handle : acc),
    undefined,
  );
  const title = handle?.title ?? branding.displayName;
  const subtitle = handle?.subtitle ?? "Backoffice";

  return (
    <div className="min-h-screen w-full lg:grid lg:grid-cols-2 bg-background">
      {/* Left panel - Auth forms */}
      <div className="relative flex flex-col h-full">
        {/* Header */}
        <header className="relative z-10 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary/20 shadow-lg shadow-primary/30">
                <Gem className="w-5 h-5" />
              </div>
              <div className="absolute inset-0 rounded-xl bg-gradient-to-tr from-transparent via-white/30 to-transparent" />
            </div>
            <div>
              <h1 className="text-xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                {title}
              </h1>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <ThemeToggle />
        </header>

        {/* Auth form container */}
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
          <div className="relative w-full max-w-sm">
            <Outlet />
          </div>
        </div>

        {/* Footer */}
        <footer className="relative z-10 px-6 py-4 text-center text-sm text-muted-foreground bg-background/80 backdrop-blur-sm">
          <p>
            &copy; {new Date().getFullYear()} {branding.legalName}.
          </p>
        </footer>
      </div>

      {/* Right panel - Animated Gradient */}
      <style>{`
        @keyframes gradient-shift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
      `}</style>
      <div className="relative hidden lg:flex p-8 bg-background">
        <div
          className="flex-1 relative flex flex-col items-center justify-center bg-gradient-to-br from-primary via-background to-secondary/50 overflow-hidden rounded-2xl"
          style={{
            backgroundSize: "200% 200%",
            animation: "gradient-shift 12s ease infinite",
          }}
        >
          <motion.div
            className="absolute inset-0 bg-gradient-to-tr from-primary/10 via-transparent to-secondary/10"
            animate={{ opacity: [0.5, 1, 0.5] }}
            transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="absolute inset-0 bg-gradient-to-bl from-primary/5 to-secondary/5"
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 2 }}
          />
        </div>
      </div>
    </div>
  );
}
