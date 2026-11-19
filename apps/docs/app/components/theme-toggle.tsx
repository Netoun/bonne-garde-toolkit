import { Moon, Sun } from "lucide-react";
import * as React from "react";

import { Button } from "@acme/ui/components/button";

export const DOCS_THEME_STORAGE_KEY = "bonne-garde-docs-theme";

export function docsThemeInitScript(): string {
  return `(function(){try{var t=localStorage.getItem("${DOCS_THEME_STORAGE_KEY}");if(t==="dark"){document.documentElement.classList.add("dark")}}catch(e){}})();`;
}

function isDarkMode() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

export function ThemeToggle() {
  const [dark, setDark] = React.useState(false);

  React.useEffect(() => {
    setDark(isDarkMode());
  }, []);

  const toggle = () => {
    const nextDark = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", nextDark);
    if (nextDark) {
      localStorage.setItem(DOCS_THEME_STORAGE_KEY, "dark");
    } else {
      localStorage.removeItem(DOCS_THEME_STORAGE_KEY);
    }
    setDark(nextDark);
  };

  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={toggle} aria-label="Toggle theme">
      {dark ? <Moon /> : <Sun />}
    </Button>
  );
}
