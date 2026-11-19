import { fireEvent, render, screen } from "@testing-library/react";
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
});
