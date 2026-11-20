import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

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

  it("names the copy button Copied for two seconds after copying bun command", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<InstallCommand name="button" />);

    await fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("bunx bonne-garde add button");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
      },
      { timeout: 2500 },
    );
  });
});
