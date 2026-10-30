import { describe, expect, it } from "bun:test";
import {
  assertBranding,
  formatEmailFrom,
  renderBrandingModule,
  slugFromNpmScope,
} from "./gen-branding";

describe("assertBranding", () => {
  it("accepts a complete branding object", () => {
    const branding = assertBranding({
      displayName: "My App",
      shortName: "My App",
      npmScope: "@acme",
      publicOrigin: "https://www.example.com",
      supportEmail: "support@example.com",
      legalName: "My App",
    });
    expect(branding.displayName).toBe("My App");
    expect(branding.npmScope).toBe("@acme");
  });

  it("rejects missing keys", () => {
    expect(() => assertBranding({ displayName: "X" })).toThrow(/missing/i);
  });

  it("rejects npmScope without @", () => {
    expect(() =>
      assertBranding({
        displayName: "My App",
        shortName: "My App",
        npmScope: "acme",
        publicOrigin: "https://www.example.com",
        supportEmail: "support@example.com",
        legalName: "My App",
      }),
    ).toThrow(/npmScope/);
  });
});

describe("renderBrandingModule", () => {
  it("emits a typed branding export", () => {
    const source = renderBrandingModule({
      displayName: "My App",
      shortName: "My App",
      npmScope: "@acme",
      publicOrigin: "https://www.example.com",
      supportEmail: "support@example.com",
      legalName: "My App",
    });
    expect(source).toContain("export const branding");
    expect(source).toContain('"My App"');
    expect(source).toContain('"@acme"');
    expect(source).toContain("satisfies Branding");
  });
});

describe("formatEmailFrom", () => {
  it("builds a From header from legal name and address", () => {
    expect(formatEmailFrom("My App", "noreply@example.com")).toBe("My App <noreply@example.com>");
  });
});

describe("slugFromNpmScope", () => {
  it("strips @ from the scope", () => {
    expect(slugFromNpmScope("@acme")).toBe("acme");
    expect(slugFromNpmScope("@acme-corp")).toBe("acme-corp");
  });
});
