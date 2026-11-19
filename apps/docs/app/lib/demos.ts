const demoModules = import.meta.glob("../demos/*.tsx");

function demoModuleKey(name: string): string {
  return `../demos/${name}.tsx`;
}

export function itemHasDemo(name: string): boolean {
  return demoModuleKey(name) in demoModules;
}

export function loadItemDemo(name: string) {
  const loader = demoModules[demoModuleKey(name)];
  if (!loader) {
    return undefined;
  }
  return loader as () => Promise<{ default: import("react").ComponentType }>;
}
