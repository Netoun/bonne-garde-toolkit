import { describe, expect, it } from "bun:test";
import { collectBranding, rewriteScopeInText, shouldScanFile, writeProductReadme } from "./brand";
import { branding } from "../packages/config/src/branding.generated";

it("keeps generated product documentation aligned with the verification workflow", () => {
  const readme = writeProductReadme(branding);
  expect(readme).toContain("React Router v8");
  expect(readme).toContain("bun run verify");
  expect(readme).toContain("local development only");
});

describe("collectBranding", () => {
  it("fills from defaults and validates", () => {
    const branding = collectBranding(
      { displayName: "Acme Corp", npmScope: "@acme-corp" },
      {
        displayName: "My App",
        shortName: "My App",
        npmScope: "@acme",
        publicOrigin: "https://www.example.com",
        supportEmail: "support@example.com",
        legalName: "My App",
      },
    );
    expect(branding.displayName).toBe("Acme Corp");
    expect(branding.npmScope).toBe("@acme-corp");
    expect(branding.shortName).toBe("My App");
  });
});

describe("rewriteScopeInText", () => {
  it("replaces all scope occurrences", () => {
    const input = 'import x from "@acme/ui"; const n = "@acme/api";';
    expect(rewriteScopeInText(input, "@acme", "@acme-corp")).toBe(
      'import x from "@acme-corp/ui"; const n = "@acme-corp/api";',
    );
  });

  it("is a no-op when scopes match", () => {
    expect(rewriteScopeInText("hello @acme", "@acme", "@acme")).toBe("hello @acme");
  });
});

describe("shouldScanFile", () => {
  it("includes source and docs, excludes lockfiles and tests", () => {
    expect(shouldScanFile("/repo/apps/api/src/app.ts")).toBe(true);
    expect(shouldScanFile("/repo/README.md")).toBe(true);
    expect(shouldScanFile("/repo/bun.lock")).toBe(false);
    expect(shouldScanFile("/repo/packages/config/src/gen-branding.test.ts")).toBe(false);
  });
});
