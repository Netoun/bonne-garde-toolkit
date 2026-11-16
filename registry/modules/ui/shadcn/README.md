# ui/shadcn

The host package of the UI items: `packages/ui`, with the subpath exports the items import through,
its `tsconfig.json`, `components.json` and the Tailwind theme. Extracted from this repo's legacy
`packages/ui`; the components themselves are items ([030](../../../../docs/specs/030-ui-registry.md)).

```bash
bunx bg add ui/shadcn button
```

`bg add button` without this module fails and names it: an item with a file under `packages/ui/`
needs a `ui` module, installed or named in the same call.

## What it writes

| File                                        | What it is                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/ui/package.json`                  | `{{SCOPE}}/ui`: the `exports`, the `registry` and `typecheck` scripts             |
| `packages/ui/tsconfig.json`                 | extends the project's, adds the `DOM` libs the components need                    |
| `packages/ui/components.json`               | the shadcn CLI config: `base-vega`, neutral, lucide, aliases on `{{SCOPE}}/ui/*`  |
| `packages/ui/src/styles/globals.css`        | `tailwindcss`, `tailwindcss-animate`, the theme import, `@source` for the package |
| `packages/ui/src/styles/themes/default.css` | the theme tokens                                                                  |
| `packages/ui/src/env.d.ts`                  | an empty file, see below                                                          |

The `package.json` is vendored, so it carries `exports` and `scripts` and no dependency map: the
planner merges the variant's into it ([035](../../../../docs/specs/035-module-registry.md)).

### Exports

An item imports its siblings through the package name (`{{SCOPE}}/ui/lib/utils`), which a
generated project resolves through `exports` and nothing else, so every subpath is listed:

| Subpath                | File                              |
| ---------------------- | --------------------------------- |
| `./components/*`       | `./src/components/*.tsx`          |
| `./hooks/*`            | `./src/hooks/*.ts`                |
| `./lib/*`              | `./src/lib/*.ts`                  |
| `./globals.css`        | `./src/styles/globals.css`        |
| `./themes/default.css` | `./src/styles/themes/default.css` |

### `src/env.d.ts`

`tsc --noEmit` fails with TS18003 when the project has no input file, and `packages/ui` holds no
TypeScript until an item adds a component. Without this file `bun run typecheck` is red right after
`bg add ui/shadcn`, which is also what `checks` runs.

## Dependencies

Exact versions, the union the whole catalog needs. 030 wants each item's dependencies merged when
the item is added, which takes a patch (`jsonc.merge`); until then a project with this module
installs packages its items may not use.

| Package                              | Version      | Imported by                                                            |
| ------------------------------------ | ------------ | ---------------------------------------------------------------------- |
| `@base-ui/react`                     | 1.7.0        | 18 components                                                          |
| `class-variance-authority`           | 0.7.1        | `alert`, `badge`, `button`, `sidebar`, `tabs`, `toggle`                |
| `clsx`, `tailwind-merge`             | 2.1.1, 3.6.0 | `lib/utils`                                                            |
| `lucide-react`                       | 1.29.0       | ten components with icons                                              |
| `motion`                             | 13.0.0       | `badge`, `button`, `card`, `checkbox`, `empty-state`, `lib/animations` |
| `vaul`                               | 1.1.2        | `drawer`                                                               |
| `tailwindcss`, `tailwindcss-animate` | 4.3.3, 1.0.7 | `globals.css`                                                          |
| `react`, `react-dom`                 | 19.2.8       | everything; the peers of `@base-ui/react`, `motion` and `vaul`         |
| `@types/react` (dev)                 | 19.2.18      | the typecheck                                                          |

`react` and `react-dom` are the versions the `web` shells pin, so a project has one copy of each. The
legacy package listed them as `peerDependencies`; a variant has no peer map, and 035 keeps
dependency maps out of a vendored file, so they are ordinary dependencies here.

## Known gaps

- The theme names `Urbanist Variable` and `Faustina Variable`. A front loads them (`@fontsource-variable/*`);
  this module does not, and without them the theme falls back to `system-ui` and `Georgia`.
