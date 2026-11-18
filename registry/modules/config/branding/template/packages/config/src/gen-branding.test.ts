import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  assertBranding,
  formatEmailFrom,
  renderBrandingModule,
  renderWebManifest,
  slugFromNpmScope,
  type Branding,
} from "./gen-branding";

const complete: Branding = {
  displayName: "My App",
  shortName: "My App",
  description: "The My App web app.",
  lang: "en",
  themeColor: "#000000",
  backgroundColor: "#ffffff",
  npmScope: "@acme",
  publicOrigin: "https://www.example.com",
  supportEmail: "support@example.com",
  legalName: "My App",
};

/** The `src` of each icon a web manifest names. */
function iconSources(manifest: string): string[] {
  const parsed: unknown = JSON.parse(manifest);
  const icons =
    typeof parsed === "object" && parsed !== null && "icons" in parsed ? parsed.icons : [];
  return Array.isArray(icons)
    ? icons.flatMap((icon: unknown) =>
        typeof icon === "object" && icon !== null && "src" in icon && typeof icon.src === "string"
          ? [icon.src]
          : [],
      )
    : [];
}

describe("assertBranding", () => {
  it("accepts a complete branding object", () => {
    const branding = assertBranding(complete);
    expect(branding.displayName).toBe("My App");
    expect(branding.npmScope).toBe("@acme");
    expect(branding.themeColor).toBe("#000000");
  });

  it("rejects missing keys", () => {
    expect(() => assertBranding({ displayName: "X" })).toThrow(/missing/i);
  });

  it("names the manifest keys it lacks, and a blank one", () => {
    expect(() => assertBranding({ ...complete, description: undefined, lang: undefined })).toThrow(
      /description, lang/,
    );
    expect(() => assertBranding({ ...complete, themeColor: " " })).toThrow(/themeColor/);
  });

  it("rejects npmScope without @", () => {
    expect(() => assertBranding({ ...complete, npmScope: "acme" })).toThrow(/npmScope/);
  });
});

describe("renderBrandingModule", () => {
  it("emits a typed branding export", () => {
    const source = renderBrandingModule(complete);
    expect(source).toContain("export const branding");
    expect(source).toContain('"My App"');
    expect(source).toContain('"@acme"');
    expect(source).toContain("satisfies Branding");
  });
});

describe("renderWebManifest", () => {
  it("takes the name, description, colours and language from branding", () => {
    const manifest: unknown = JSON.parse(
      renderWebManifest({
        ...complete,
        displayName: "Acme Cloud",
        shortName: "Acme",
        description: "Acme, in the cloud.",
        lang: "fr",
        themeColor: "#112233",
        backgroundColor: "#f0f0f0",
      }),
    );
    expect(manifest).toMatchObject({
      name: "Acme Cloud",
      short_name: "Acme",
      description: "Acme, in the cloud.",
      lang: "fr",
      theme_color: "#112233",
      background_color: "#f0f0f0",
    });
  });

  it("names its icons by root URL, the two sizes an installable app needs", () => {
    expect(iconSources(renderWebManifest(complete))).toEqual([
      "/android-chrome-192x192.png",
      "/android-chrome-512x512.png",
    ]);
  });

  it("is JSON that ends with a newline, so a formatter has nothing to change", () => {
    const text = renderWebManifest(complete);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
  });
});

describe("the files the generator writes", () => {
  const PACKAGE = join(import.meta.dirname, "..");
  const FAVICONS = join(PACKAGE, "assets/favicons");
  /**
   * The registry keeps a placeholder where a project has its scope, and the manifest holds none of it: any
   * valid scope renders the same manifest, so this runs on the registry's file and on the project's.
   */
  const shippedBranding = (): Branding => {
    const parsed: unknown = JSON.parse(readFileSync(join(PACKAGE, "branding.json"), "utf8"));
    return assertBranding(
      typeof parsed === "object" && parsed !== null ? { ...parsed, npmScope: "@acme" } : parsed,
    );
  };

  it("hold what it renders from branding.json: a branding.json edited without `vp run gen:branding` fails here", () => {
    expect(readFileSync(join(FAVICONS, "site.webmanifest"), "utf8")).toBe(
      renderWebManifest(shippedBranding()),
    );
  });

  it("include every icon the manifest names", () => {
    for (const src of iconSources(renderWebManifest(shippedBranding()))) {
      expect(existsSync(join(FAVICONS, basename(src)))).toBe(true);
    }
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
