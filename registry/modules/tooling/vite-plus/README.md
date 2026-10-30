# tooling/vite-plus

The quality gate of a project: the Vite+ lint rules, the fmt options, the staged-files check, and the
git hook that runs it. `bun run check` is the gate; this module is what makes it strict.

```bash
bunx bg add tooling/vite-plus
```

## What it writes

| File                | What it is                                                                              |
| ------------------- | --------------------------------------------------------------------------------------- |
| `vite.config.ts`    | `lint` (rules, plugins, ignore patterns), `fmt` (options, ignore patterns) and `staged` |
| `.husky/pre-commit` | `bunx vp staged`: runs `vp check --fix` on the staged `*.{ts,tsx,js,jsx,mjs,cjs}` files |

It declares no dependency and no workspace: the `vite-plus` and `husky` dependencies and the `fmt`,
`lint`, `check` and `prepare` scripts come with the base template, because `bg add` cannot edit a
root `package.json` yet. Once the module is added, `bun run check` runs the rules above, and
`checks: ["bun run check"]` is what a caller runs to prove it.

## What the base template keeps

`templates/base` ships no `vite.config.ts`. A file that `create` leaves on disk and `bg.json` does not
record is a collision for `add` (it never overwrites one without `--force`), so the base cannot ship
what this module ships.

- `fmt` is `vp fmt --write`: Vite+ defaults.
- `lint` and `check` carry `--no-error-on-unmatched-pattern`. The empty base has no source file to
  lint, and `vp lint` exits 1 on "No files found to lint". A file with a lint error still fails.
- `prepare` is `husky`. With no `.git` it prints "`.git` can't be found" and exits 0, so
  `bg create --no-git` still installs. In a git project it points `core.hooksPath` at `.husky/_`,
  and `.husky/pre-commit` runs from the first commit after this module is added.

Without this module, a project with an app that has its own `vite.config.ts` (`spa-react-router`)
fails `bun run check`: with no root config, `vp fmt` tries to load the app's one as a Vite+ config.
The root `vite.config.ts` stops that, which is part of why the module exists.

## Extracted from this repo's root `vite.config.ts`

The lint rules, the plugins, the `es2022` and `node` env, the fmt options and `staged` are the root
config's, unchanged. Two things differ:

- **Added:** `.bg/`, the scratch root of the intentions ([065](../../../../docs/specs/065-intentions.md)),
  in both ignore lists. The base template's stub carried it; the root config has no use for it.
- **Dropped:** the three `lint.overrides`. The dissolution plan (09) deletes them with the legacy
  apps they are keyed on, and a module has no way to say "this path, if it exists".

| Override dropped                                | What it did                                    | Keyed on                                    |
| ----------------------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| `apps/{spa,ssr,static}`, `packages/{ui,emails}` | added the `react` plugin and the `browser` env | the legacy fronts and the shared React code |
| `apps/api/**`                                   | `no-console: off`                              | the legacy `api` app                        |
| `scripts/**`                                    | `no-console: off`                              | this repository's `scripts/` directory      |

**What that costs.** Several of those paths are where generated code lands: `spa-react-router`
writes `apps/spa`, the UI items write `packages/ui`, `api-elysia` writes `apps/api` (035 fixes
`api` there) and `portless` writes `scripts/dev-portless.ts`. In a generated project the `react`
plugin does not run on those files, and `no-console` is a warning everywhere. The golden project
shows the second: `bun run check` exits 0 with two `no-console` warnings from `scripts/dev-portless.ts`.
A warning does not fail `vp check`; a missing plugin does not either, it only checks less.

Putting an override back is a config change that needs an owner. `tooling` is `one` and this file is
the only place the rule can live, so the module that wants it (a `web` module for React) would have
to patch `vite.config.ts`, and `add` refuses patches today.

## What this module does not do

- `knip` and its `knip.jsonc` wait for the first patch type (`scripts.merge`): a root `package.json`
  edit is a patch, and `add` refuses patches today.
- It does not run the gate on `bg add`: spec 050 step 15 is not implemented, so `checks` is printed.
  `bun run golden` runs it.
