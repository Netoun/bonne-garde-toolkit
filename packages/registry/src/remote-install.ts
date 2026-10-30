import { isModuleCategory, MODULE_CATEGORIES } from "@bonne-garde/schema";
import { FETCH_CONCURRENCY, RegistryFileNotFoundError } from "./github-source";
import { parseModuleFile } from "./module-catalog";
import type { ModuleRef } from "./module-plan";
import { mapLimit } from "./pool";
import type { InstallPlan } from "./resolve-plan";
import type { RegistryCatalog, RegistryModule } from "./types";

const MODULE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** What a name on the command line may be as a module (spec 050 step 3): `<category>/<id>`, or a bare id in any category. */
function moduleRefsFor(name: string): ModuleRef[] {
  const [first, second, ...more] = name.split("/");
  if (first === undefined || more.length > 0) {
    return [];
  }
  if (second === undefined) {
    return MODULE_ID.test(first)
      ? MODULE_CATEGORIES.map((category) => ({ category, id: first }))
      : [];
  }
  return isModuleCategory(first) && MODULE_ID.test(second) ? [{ category: first, id: second }] : [];
}

/**
 * A registry read over the network has no directory to list, so its modules cannot be found by
 * walking `modules/`: this fetches the `module.json` that each name could mean and keeps the ones
 * that exist. A bare name is looked up in every category, so that "both an item and a module" and
 * "names modules in two categories" are refused as they are from a local registry. A 404 here only
 * means "not a module"; any other failure is real. A local catalog is returned as it is.
 */
export async function loadNamedModules(
  catalog: RegistryCatalog,
  names: string[],
): Promise<RegistryCatalog> {
  const { reader } = catalog;
  if (reader === undefined) {
    return catalog;
  }
  const wanted = new Map(
    names.flatMap(moduleRefsFor).map((ref) => [`${ref.category}/${ref.id}`, ref]),
  );
  const found = await mapLimit(
    [...wanted.values()],
    FETCH_CONCURRENCY,
    async ({ category, id }): Promise<RegistryModule | null> => {
      const dir = `${catalog.rootDir}/modules/${category}/${id}`;
      let raw: string;
      try {
        raw = await reader.read(`${dir}/module.json`);
      } catch (error) {
        if (error instanceof RegistryFileNotFoundError) {
          return null;
        }
        throw error;
      }
      return { manifest: parseModuleFile(raw, category, id), dir, reader };
    },
  );
  return { ...catalog, modules: found.filter((module) => module !== null) };
}

/**
 * Reads the files of the planned items into `content`, which `applyInstallPlan` uses in place of
 * a read from disk. It is the fetch step of a github install: done while planning, before anything
 * is written, so a file the registry lacks fails the whole install and `--dry-run` fetches what a
 * real run would. A local catalog's plan is returned as it is.
 */
export async function readPlanFiles(
  catalog: RegistryCatalog,
  plan: InstallPlan,
): Promise<InstallPlan> {
  const { reader } = catalog;
  if (reader === undefined) {
    return plan;
  }
  const paths = [
    ...new Set(
      plan.items.flatMap((item) =>
        (item.files ?? []).filter((file) => file.content === undefined).map((file) => file.path),
      ),
    ),
  ];
  const content = new Map(
    await mapLimit(
      paths,
      FETCH_CONCURRENCY,
      async (path) => [path, await reader.read(path)] as const,
    ),
  );
  return {
    ...plan,
    items: plan.items.map((item) =>
      item.files === undefined
        ? item
        : {
            ...item,
            files: item.files.map((file) => {
              const text = content.get(file.path);
              return text === undefined || file.content !== undefined
                ? file
                : { ...file, content: text };
            }),
          },
    ),
  };
}
