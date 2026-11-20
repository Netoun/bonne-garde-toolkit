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
  env?: Record<string, string>;
  with?: Record<string, string>;
}
interface Job {
  needs?: string;
  environment?: { name: string; url: string };
  permissions?: Record<string, string>;
  steps: Step[];
}
const workflow = parse(source) as {
  on: { push: { tags: string[] }; workflow_dispatch: { inputs: { tag: unknown } } };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: { build: Job; deploy: Job };
};

const { build, deploy } = workflow.jobs;
const step = (job: Job, matcher: (s: Step) => boolean) => job.steps.find(matcher);

describe(".github/workflows/docs.yml", () => {
  it("runs on a pushed version tag and by hand with a tag", () => {
    expect(workflow.on.push.tags).toEqual(["v*"]);
    expect(workflow.on.workflow_dispatch.inputs.tag).toBeDefined();
  });

  it("builds the tag, never main", () => {
    const checkout = step(build, (s) => s.uses?.startsWith("actions/checkout@") ?? false);
    expect(checkout?.with?.ref).toMatch(/^refs\/tags\//);
    expect(checkout?.with?.ref).toContain("inputs.tag || github.ref_name");
    expect(checkout?.with?.ref).not.toContain("main");
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("takes the base path from configure-pages", () => {
    expect(step(build, (s) => s.id === "pages")?.uses).toMatch(/^actions\/configure-pages@/);
    const docsBuild = step(build, (s) => s.run === "bun run docs:build");
    expect(docsBuild?.env?.DOCS_BASE_PATH).toBe("${{ steps.pages.outputs.base_path }}");
  });

  it("uploads the static client build", () => {
    const upload = step(
      build,
      (s) => s.uses?.startsWith("actions/upload-pages-artifact@") ?? false,
    );
    expect(upload?.with?.path).toBe("apps/docs/build/client");
  });

  it("deploys to the github-pages environment with the pages permissions", () => {
    expect(deploy.needs).toBe("build");
    expect(deploy.environment?.name).toBe("github-pages");
    expect(deploy.environment?.url).toBe("${{ steps.deployment.outputs.page_url }}");
    expect(deploy.permissions).toMatchObject({ pages: "write", "id-token": "write" });
    expect(step(deploy, (s) => s.id === "deployment")?.uses).toMatch(/^actions\/deploy-pages@/);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({ group: "pages", "cancel-in-progress": false });
  });

  it("pins every action to a commit SHA", () => {
    const uses = [...build.steps, ...deploy.steps].flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    for (const action of uses) expect(action, action).toMatch(/@[0-9a-f]{40}$/);
  });

  it("holds no Cloudflare credential", () => {
    expect(source).not.toContain("CLOUDFLARE_");
  });
});
