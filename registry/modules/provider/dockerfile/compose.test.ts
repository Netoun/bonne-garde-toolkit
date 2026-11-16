import { describe, expect, it } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// `compose.yaml` is the provider's, and the provider knows no module: a key belongs to the module whose
// code reads it (035), and a module's key reaches the container through the project's `.env`, which the
// file forwards as a whole. These tests read the file and the manifests as data; `docker compose config`
// is what proves Compose accepts it, and golden's docker phase what proves the image runs.

const MODULES = join(import.meta.dir, "..", "..");
const COMPOSE = join(import.meta.dir, "template", "compose.yaml");

type Manifest = {
  category: string;
  id: string;
  variants: { env?: { name: string }[] }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isManifest(value: unknown): value is Manifest {
  return (
    isRecord(value) &&
    typeof value.category === "string" &&
    typeof value.id === "string" &&
    Array.isArray(value.variants)
  );
}

/** The env keys each module declares, by `<category>/<id>`. */
async function declaredKeys(): Promise<Map<string, string[]>> {
  const keys = new Map<string, string[]>();
  for (const category of await readdir(MODULES, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    for (const module of await readdir(join(MODULES, category.name), { withFileTypes: true })) {
      const file = Bun.file(join(MODULES, category.name, module.name, "module.json"));
      if (!module.isDirectory() || !(await file.exists())) continue;
      const manifest: unknown = await file.json();
      if (!isManifest(manifest)) continue;
      keys.set(
        `${manifest.category}/${manifest.id}`,
        manifest.variants.flatMap((variant) => (variant.env ?? []).map(({ name }) => name)),
      );
    }
  }
  return keys;
}

async function service(): Promise<Record<string, unknown>> {
  const document: unknown = Bun.YAML.parse(await Bun.file(COMPOSE).text());
  const services = isRecord(document) ? document.services : undefined;
  const app = isRecord(services) ? services.app : undefined;
  if (!isRecord(app)) {
    throw new Error("compose.yaml has no service `app`");
  }
  return app;
}

describe("compose.yaml", () => {
  it("forwards the project's .env generically, and does not fail without one", async () => {
    // The long form with `required: false` is Docker Compose 2.24 or later; the README says so.
    expect((await service()).env_file).toEqual([{ path: ".env", required: false }]);
  });

  it("names no key of another module: a module's key reaches the container through .env", async () => {
    const text = await Bun.file(COMPOSE).text();
    // A build argument is the provider's: it is how the image bakes the SPA's API origin in, whatever
    // the web module calls the key it reads at run time.
    const { build } = await service();
    const buildArguments = isRecord(build) && isRecord(build.args) ? Object.keys(build.args) : [];
    const others = [...(await declaredKeys())]
      .filter(([module]) => !module.startsWith("provider/"))
      .flatMap(([module, names]) => names.map((name) => [name, module] as const))
      .filter(([name]) => !buildArguments.includes(name));
    const named = (name: string) => new RegExp(`(?<![A-Z0-9_])${name}(?![A-Z0-9_])`).test(text);

    expect(others.length).toBeGreaterThan(0);
    expect(others.filter(([name]) => named(name))).toEqual([]);
  });

  it("sets only the provider's own keys, and passes the SPA the one build argument it bakes in", async () => {
    const ownKeys = (await declaredKeys()).get("provider/dockerfile") ?? [];
    const { environment, build } = await service();
    const environmentKeys = isRecord(environment) ? Object.keys(environment) : [];

    expect(environmentKeys.sort()).toEqual(["APP_URL", "TRUSTED_PROXY_HEADER"]);
    for (const key of environmentKeys) {
      expect(ownKeys).toContain(key);
    }
    expect(isRecord(build) && isRecord(build.args) ? Object.keys(build.args) : null).toEqual([
      "VITE_API_URL",
    ]);
  });
});
