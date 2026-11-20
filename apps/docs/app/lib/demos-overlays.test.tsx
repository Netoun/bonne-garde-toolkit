import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { itemHasDemo } from "./demos";

const OVERLAY_ITEMS = [
  "alert-dialog",
  "context-menu",
  "dialog",
  "drawer",
  "dropdown-menu",
  "popover",
  "select",
  "sheet",
  "sidebar",
  "tabs",
  "tooltip",
] as const;

type OverlayItem = (typeof OVERLAY_ITEMS)[number];

import type { ComponentType } from "react";

const demoModules = import.meta.glob<{ default: ComponentType }>("../demos/*.tsx");

async function loadDemo(name: OverlayItem) {
  const key = `../demos/${name}.tsx`;
  const loader = demoModules[key];
  if (!loader) {
    throw new Error(`Missing demo module for ${name}`);
  }
  return (await loader()).default;
}

type OpenInteraction =
  | { kind: "click-button"; name: RegExp }
  | { kind: "context-menu"; text: RegExp }
  | { kind: "combobox"; name: RegExp }
  | { kind: "tab"; name: RegExp }
  | { kind: "sidebar-trigger" };

const OPEN_INTERACTIONS: Record<OverlayItem, OpenInteraction> = {
  "alert-dialog": { kind: "click-button", name: /show alert dialog/i },
  dialog: { kind: "click-button", name: /open dialog/i },
  drawer: { kind: "click-button", name: /open drawer/i },
  "dropdown-menu": { kind: "click-button", name: /open menu/i },
  popover: { kind: "click-button", name: /open popover/i },
  sheet: { kind: "click-button", name: /open sheet/i },
  tooltip: { kind: "click-button", name: /show tooltip/i },
  select: { kind: "combobox", name: /email/i },
  "context-menu": { kind: "context-menu", text: /right click here/i },
  tabs: { kind: "tab", name: /password/i },
  sidebar: { kind: "sidebar-trigger" },
};

const OPENED_ROLE: Partial<Record<OverlayItem, string>> = {
  "alert-dialog": "alertdialog",
  dialog: "dialog",
  drawer: "dialog",
  sheet: "dialog",
  popover: "dialog",
  "dropdown-menu": "menu",
  "context-menu": "menu",
  select: "listbox",
};

describe("overlay and navigation demos", () => {
  const consoleErrors: string[] = [];

  beforeEach(() => {
    consoleErrors.length = 0;
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has a demo file for every overlay item", () => {
    for (const name of OVERLAY_ITEMS) {
      expect(itemHasDemo(name)).toBe(true);
    }
  });

  it.each(OVERLAY_ITEMS)(
    "%s renders without console errors and opens from its trigger",
    async (name) => {
      const Demo = await loadDemo(name);
      const view = render(<Demo />);
      expect(consoleErrors, `console errors while rendering ${name}`).toEqual([]);

      const interaction = OPEN_INTERACTIONS[name];
      if (interaction.kind === "click-button") {
        const button = screen.getByRole("button", { name: interaction.name });
        if (name === "tooltip") {
          fireEvent.pointerEnter(button);
          fireEvent.focus(button);
        } else {
          fireEvent.click(button);
        }
      } else if (interaction.kind === "context-menu") {
        const trigger = screen.getByText(interaction.text);
        fireEvent.contextMenu(trigger);
      } else if (interaction.kind === "combobox") {
        fireEvent.click(screen.getByRole("combobox", { name: interaction.name }));
      } else if (interaction.kind === "tab") {
        fireEvent.click(screen.getByRole("tab", { name: interaction.name }));
      } else if (interaction.kind === "sidebar-trigger") {
        const trigger = view.container.querySelector('[data-slot="sidebar-trigger"]');
        expect(trigger).toBeTruthy();
        fireEvent.click(trigger as Element);
      }

      const openedRole = OPENED_ROLE[name];
      if (openedRole) {
        await waitFor(() => {
          expect(screen.getByRole(openedRole)).toBeInTheDocument();
        });
      } else if (name === "tabs") {
        expect(screen.getByRole("tabpanel", { name: /password/i })).toBeInTheDocument();
      } else if (name === "tooltip") {
        await waitFor(() => {
          expect(
            document.querySelector('[data-slot="tooltip-content"][data-open]'),
          ).toBeInTheDocument();
        });
      } else if (name === "sidebar") {
        expect(within(view.container).getByText(/sidebar demo/i)).toBeInTheDocument();
      }

      expect(consoleErrors, `console errors while interacting with ${name}`).toEqual([]);
    },
  );
});
