import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { highlight } from "../lib/highlight";
import { CodeBlock } from "./code-block";

describe("CodeBlock", () => {
  it("shows the label and copies the raw code", async () => {
    const code = "bunx bonne-garde create my-app";
    const html = await highlight(code, "bash");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CodeBlock code={code} html={html} label="Quick start" />);

    expect(screen.getByText("Quick start")).toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(code);
  });

  it("names the copy button Copied for two seconds after a click", async () => {
    const code = "export {}";
    const html = await highlight(code, "typescript");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(<CodeBlock code={code} html={html} />);

    await fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith(code);
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
