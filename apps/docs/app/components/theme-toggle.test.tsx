import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vite-plus/test";

import { DOCS_THEME_STORAGE_KEY, ThemeToggle } from "./theme-toggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.clear();
  });

  it("toggles the dark class and localStorage", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button", { name: "Toggle theme" });

    fireEvent.click(button);
    expect(document.documentElement).toHaveClass("dark");
    expect(localStorage.getItem(DOCS_THEME_STORAGE_KEY)).toBe("dark");

    fireEvent.click(button);
    expect(document.documentElement).not.toHaveClass("dark");
  });
});
