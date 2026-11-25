import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import { ItemPage } from "./item-page";

// Previews show what a user gets: the default theme, never the docs site's own tokens.
describe("ItemPage preview", () => {
  it("renders the demo with default theme classes only", async () => {
    render(
      <MemoryRouter>
        <ItemPage
          name="button"
          title="Button"
          hasDemo
          codeFiles={[]}
          npmDependencies={[]}
          registryDependencyHrefs={[]}
          moduleLinks={[]}
        />
      </MemoryRouter>,
    );

    const preview = screen.getByRole("region", { name: "Preview" });
    await screen.findAllByRole("button", {}, { timeout: 10_000 });
    expect(preview).toHaveClass("bg-muted/30");
    const classes = [preview, ...preview.querySelectorAll("*")].flatMap((el) => [...el.classList]);
    expect(classes.filter((name) => name.includes("docs-"))).toEqual([]);
  });

  it.each(["app/components/item", "app/components/module", "app/demos"])(
    "%s uses no docs-only token",
    (dir) => {
      const leaks = readdirSync(dir)
        .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
        .filter((file) => /docs-/.test(readFileSync(join(dir, file), "utf8")));
      expect(leaks).toEqual([]);
    },
  );
});
