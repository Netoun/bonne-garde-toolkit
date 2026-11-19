import { fireEvent, render, screen } from "@testing-library/react";
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
});
