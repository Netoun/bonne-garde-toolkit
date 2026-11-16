import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  initTheme: () => void;
}

function getResolvedTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: "system",
      resolvedTheme: "light",
      setTheme: (theme: Theme) => {
        const resolved = getResolvedTheme(theme);
        set({ theme, resolvedTheme: resolved });
        document.documentElement.classList.toggle("dark", resolved === "dark");
      },
      initTheme: () => {
        const { theme } = get();
        const resolved = getResolvedTheme(theme);
        set({ resolvedTheme: resolved });
        document.documentElement.classList.toggle("dark", resolved === "dark");
      },
    }),
    {
      name: "theme-storage",
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.initTheme();
        }
      },
    },
  ),
);
