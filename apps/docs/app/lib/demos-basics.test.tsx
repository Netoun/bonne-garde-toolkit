import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { itemHasDemo, loadItemDemo } from "./demos";

const BASIC_DEMO_ITEMS = [
  "alert",
  "avatar",
  "badge",
  "breadcrumb",
  "card",
  "checkbox",
  "data-table",
  "empty-state",
  "entity-card",
  "input",
  "label",
  "progress",
  "separator",
  "skeleton",
  "switch",
  "table",
  "textarea",
  "toggle",
] as const;

describe("basic and form component demos", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has a demo file for each listed item", () => {
    for (const name of BASIC_DEMO_ITEMS) {
      expect(itemHasDemo(name)).toBe(true);
    }
  });

  it.each(BASIC_DEMO_ITEMS)("renders the %s demo without console errors", async (name) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const loader = loadItemDemo(name);
    expect(loader).toBeDefined();
    const { default: Demo } = await loader!();
    render(<Demo />);

    await waitFor(() => {
      expect(errors).not.toHaveBeenCalled();
    });
  });
});
