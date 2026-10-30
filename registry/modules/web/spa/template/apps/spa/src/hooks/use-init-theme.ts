import { useEffect } from "react";
import { useThemeStore } from "{{SCOPE}}/spa/stores/theme-store";

export function useInitTheme() {
  useEffect(() => {
    useThemeStore.getState().initTheme();
  }, []);
}
