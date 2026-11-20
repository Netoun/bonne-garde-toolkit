import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { InstallCommand } from "./install-command";

describe("InstallCommand", () => {
  it("copies the pnpm tab command to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<InstallCommand name="button" />);

    fireEvent.click(screen.getByRole("tab", { name: "pnpm" }));
    await fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledWith("pnpm dlx bonne-garde add button");
  });

  describe("copy feedback", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("names the copy button Copied for two seconds on the active package manager tab", async () => {
      vi.useFakeTimers();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });

      render(<InstallCommand name="button" />);

      fireEvent.click(screen.getByRole("tab", { name: "pnpm" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Copy" }));
        await Promise.resolve();
      });
      expect(writeText).toHaveBeenCalledWith("pnpm dlx bonne-garde add button");
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1999);
      });
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });
  });
});
