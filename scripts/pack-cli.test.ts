import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

describe("pack-cli", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  });

  test("packed create-bonne-garde creates a project from embedded templates", async () => {
    const pack = Bun.spawn(["bun", "scripts/pack-cli.ts"], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await pack.exited).toBe(0);

    const parent = await mkdtemp(join(tmpdir(), "bg-pack-"));
    dirs.push(parent);

    const create = Bun.spawn(
      [
        "bun",
        join(ROOT, "dist/npm/create-bonne-garde/src/create-bin.ts"),
        "packed-app",
        "--yes",
        "--no-git",
        "--no-install",
        "--registry",
        `local:${join(ROOT, "registry")}`,
      ],
      {
        cwd: parent,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const code = await create.exited;
    const stderr = await new Response(create.stderr).text();
    expect(code).toBe(0);
    expect(stderr).toBe("");

    const bg = await Bun.file(join(parent, "packed-app/bg.json")).json();
    expect(bg.version).toBe(2);
    expect(bg.scope).toBe("@packed-app");
  });
});
