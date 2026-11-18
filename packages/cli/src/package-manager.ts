import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./run";

/** The package managers a project can be created with: one `pm` module each (040). */
export const PACKAGE_MANAGERS = ["bun", "pnpm"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

function known(name: string | undefined): PackageManager | null {
  return PACKAGE_MANAGERS.find((pm) => pm === name) ?? null;
}

/** The package manager the root package.json pins in `packageManager`, which its `pm` module writes. */
export async function packageManagerOf(projectRoot: string): Promise<PackageManager> {
  const file = join(projectRoot, "package.json");
  const manifest: unknown = JSON.parse(await readFile(file, "utf8"));
  const pinned =
    typeof manifest === "object" && manifest !== null && "packageManager" in manifest
      ? manifest.packageManager
      : undefined;
  const pm = typeof pinned === "string" ? known(pinned.split("@")[0]) : null;
  if (pm === null) {
    throw new Error(
      pinned === undefined
        ? `${file} pins no package manager: add pm/bun or pm/pnpm`
        : `${file} pins ${String(pinned)}, which bg does not install with: add pm/bun or pm/pnpm`,
    );
  }
  return pm;
}

/** `<pm> install` in the project, with the package manager its package.json pins. */
export async function installDependencies(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const pm = await packageManagerOf(projectRoot);
  const code = await run([pm, "install"], { cwd: projectRoot, output: "inherit", env }).catch(
    (error: unknown) => {
      throw error instanceof Error && "code" in error && error.code === "ENOENT"
        ? new Error(
            `${pm} not found: the project's package.json pins it. Install ${pm}, or run bg with --no-install`,
          )
        : error;
    },
  );
  if (code !== 0) {
    throw new Error(`${pm} install failed`);
  }
}

/** The package manager `create` was started from (`bun create`, `pnpm create`), when a project can use it. */
export function invokingPackageManager(
  env: NodeJS.ProcessEnv = process.env,
): PackageManager | null {
  return known(env.npm_config_user_agent?.split("/")[0]);
}
