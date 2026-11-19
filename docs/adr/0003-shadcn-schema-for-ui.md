# 3. The shadcn schema for UI items, a native schema for modules

Status: accepted

## Context

UI components are shadcn components. The shadcn registry schema is published, resolves `registryDependencies` and works with `shadcn add`. It cannot express categories, peers, variants or patches. An earlier revision hid four platform fields in `meta.bg` inside it.

## Decision

UI and feature items keep the shadcn schema untouched, tier 1 only. Modules use their own `module.json`. No item carries `meta.bg`; the one platform key an item may carry is `meta.needsModules`, on feature items.

## Consequences

- Third parties can author items, and consumers keep their shadcn tooling.
- An item that needs peers, patches or conflicts is a module.
- Items are text-only (the schema holds a file as a string); a binary file belongs to a module.
