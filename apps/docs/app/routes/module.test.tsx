import { render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import { listModules } from "../content/modules";
import Module, { loader } from "./module";

async function renderModule(category: string, id: string) {
  const Stub = createRoutesStub([{ path: "/modules/:category/:id", Component: Module, loader }]);
  const view = render(<Stub initialEntries={[`/modules/${category}/${id}`]} />);
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument());
  return view;
}

describe("Module page", () => {
  it("shows the install command and the environment of web/static", async () => {
    await renderModule("web", "static");

    expect(screen.getByRole("heading", { level: 1, name: "Static site" })).toBeInTheDocument();
    expect(document.body).toHaveTextContent("bunx bonne-garde add web/static");
    const environment = screen.getByRole("table", { name: "Environment" });
    expect(within(environment).getByText("VITE_API_URL")).toBeInTheDocument();
  });

  it("links the peers of web/static in Requires", async () => {
    await renderModule("web", "static");

    const requires = screen.getByRole("region", { name: "Requires" });
    expect(within(requires).getByRole("link", { name: "cloudflare" })).toHaveAttribute(
      "href",
      "/modules/provider/cloudflare",
    );
    expect(within(requires).getByRole("link", { name: "shadcn" })).toHaveAttribute(
      "href",
      "/modules/ui/shadcn",
    );
  });

  it("lists the four variants of web/spa", async () => {
    await renderModule("web", "spa");

    const variants = screen.getByRole("table", { name: "Variants" });
    const keys = within(variants)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[0]?.textContent);
    expect(keys).toEqual([
      "cloudflare",
      "cloudflare-without-api",
      "dockerfile",
      "dockerfile-without-api",
    ]);
  });

  it("only links to modules that have a page", async () => {
    const pages = new Set(
      (await listModules()).flatMap((section) => section.links.map((link) => link.href)),
    );

    for (const href of pages) {
      const [, , category, id] = href.split("/");
      const { unmount } = await renderModule(category!, id!);
      const requires = screen.queryByRole("region", { name: "Requires" });
      for (const link of requires ? within(requires).queryAllByRole("link") : []) {
        expect(pages, `${href} links to ${link.getAttribute("href")}`).toContain(
          link.getAttribute("href"),
        );
      }
      unmount();
    }
  });
});
