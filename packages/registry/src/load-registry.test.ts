import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalRegistry, parseRegistrySource } from "./load-registry";

describe("parseRegistrySource", () => {
  test("parses local and github sources", () => {
    expect(parseRegistrySource("local:./registry")).toEqual({
      kind: "local",
      value: "./registry",
    });
    expect(parseRegistrySource("github:acme/bg@v1.0.0")).toEqual({
      kind: "github",
      value: "acme/bg",
      ref: "v1.0.0",
    });
  });
});

describe("loadLocalRegistry", () => {
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("resolves include and absolutizes file paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-reg-"));
    dirs.push(root);
    await mkdir(join(root, "ui"), { recursive: true });
    await writeFile(
      join(root, "registry.json"),
      JSON.stringify({
        name: "bg",
        include: ["ui/registry.json"],
      }),
    );
    await writeFile(join(root, "ui", "button.tsx"), "export const Button = () => null;\n");
    await writeFile(
      join(root, "ui", "registry.json"),
      JSON.stringify({
        items: [
          {
            name: "button",
            type: "registry:ui",
            files: [{ path: "button.tsx", type: "registry:ui" }],
          },
        ],
      }),
    );

    const catalog = await loadLocalRegistry(join(root, "registry.json"));
    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]?.files?.[0]?.path).toBe(join(root, "ui", "button.tsx"));
  });
});
