import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vite-plus/test";

// `vp test` runs from the workspace root of the package: apps/docs.
const path = resolve(process.cwd(), "../../.github/workflows/docs.yml");
const source = readFileSync(path, "utf8");

interface Step {
  id?: string;
  uses?: string;
  run?: string;
  "working-directory"?: string;
  env?: Record<string, string>;
  with?: Record<string, string | number | boolean>;
}
interface Job {
  needs?: string;
  environment?: { name: string; url: string };
  permissions?: Record<string, string>;
  steps: Step[];
}
const workflow = parse(source) as {
  on: { push: { branches: string[]; tags: string[] }; workflow_dispatch: unknown };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: { build: Job; deploy: Job };
};

const { build, deploy } = workflow.jobs;
const uses = (action: string) => (s: Step) => s.uses?.startsWith(`${action}@`) ?? false;
const checkouts = build.steps.filter(uses("actions/checkout"));
const checkoutAt = (dir: string) => checkouts.find((s) => s.with?.path === dir);
const docsBuildIn = (dir: string) =>
  build.steps.find((s) => s.run === "bun run docs:build" && s["working-directory"] === dir);

describe(".github/workflows/docs.yml", () => {
  it("runs on a push to main, on a pushed version tag and by hand", () => {
    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("checks out main with every tag, and the release in its own directory", () => {
    expect(checkouts).toHaveLength(2);
    expect(checkoutAt("next")?.with).toMatchObject({ ref: "main", "fetch-depth": 0 });
    for (const checkout of checkouts) expect(checkout.with?.["persist-credentials"]).toBe(false);
  });

  it("builds the root from the latest version tag, whatever triggered the run", () => {
    const latest = build.steps.find((s) => s.id === "latest");
    expect(latest?.["working-directory"]).toBe("next");
    expect(latest?.run).toContain("git tag --list 'v*' --sort=-v:refname");

    const ref = String(checkoutAt("release")?.with?.ref);
    expect(ref).toBe("refs/tags/${{ steps.latest.outputs.tag }}");
    expect(ref).not.toContain("github.ref");
  });

  it("serves the release at the base path and main under next/", () => {
    expect(build.steps.find((s) => s.id === "pages")?.uses).toMatch(/^actions\/configure-pages@/);
    expect(docsBuildIn("release")?.env?.DOCS_BASE_PATH).toBe(
      "${{ steps.pages.outputs.base_path }}",
    );
    expect(docsBuildIn("next")?.env?.DOCS_BASE_PATH).toBe(
      "${{ steps.pages.outputs.base_path }}/next",
    );
    for (const dir of ["release", "next"]) {
      expect(
        build.steps.some(
          (s) => s.run === "bun install --frozen-lockfile" && s["working-directory"] === dir,
        ),
        dir,
      ).toBe(true);
    }
  });

  it("uploads one site: the release at the root, main in next/", () => {
    const assemble = build.steps.find((s) => s.id === "site")?.run ?? "";
    expect(assemble).toContain("cp -R release/apps/docs/build/client/. site/");
    expect(assemble).toContain("cp -R next/apps/docs/build/client/. site/next/");

    const uploads = build.steps.filter(uses("actions/upload-pages-artifact"));
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.with?.path).toBe("site");
  });

  it("deploys once, to the github-pages environment with the pages permissions", () => {
    expect(deploy.needs).toBe("build");
    expect(deploy.environment?.name).toBe("github-pages");
    expect(deploy.environment?.url).toBe("${{ steps.deployment.outputs.page_url }}");
    expect(deploy.permissions).toMatchObject({ pages: "write", "id-token": "write" });
    expect(deploy.steps.filter(uses("actions/deploy-pages"))).toHaveLength(1);
    expect(source.match(/actions\/deploy-pages@/g)).toHaveLength(1);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({ group: "pages", "cancel-in-progress": false });
  });

  it("pins every action to a commit SHA", () => {
    const actions = [...build.steps, ...deploy.steps].flatMap((s) => (s.uses ? [s.uses] : []));
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action, action).toMatch(/@[0-9a-f]{40}$/);
  });

  it("holds no Cloudflare credential", () => {
    expect(source).not.toContain("CLOUDFLARE_");
  });
});
