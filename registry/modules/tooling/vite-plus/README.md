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
- **Re-keyed:** the three `lint.overrides`. The root config names the legacy apps; this one names the
  homes [035](../../../../docs/specs/035-module-registry.md) fixes, because that is where generated
  code lands whatever the app ids are.

| Override                         | Files                           | What it does                                                         |
| -------------------------------- | ------------------------------- | -------------------------------------------------------------------- |
| React code                       | `apps/*/**`, `packages/ui/**`   | the `react` plugin, the `browser` env, five `react/*` rules at error |
| (the same, minus the server app) | `excludeFiles: ["apps/api/**"]` | `api` is Elysia code: no JSX, no `react` plugin, no `browser` env    |
| `no-console: off`                | `apps/api/**`, `scripts/**`     | a server logs, and `portless` writes `scripts/dev-portless.ts`       |

**The `react` rules are named, not inherited.** Oxlint switches on a plugin's rules only where the
plugin is enabled at the top level. An override that adds `react` to `plugins` enables the plugin and
none of its rules, so the root config's override linted React code with no React rule: the proof is a
`.map` with no `key` in a vendored SPA file, which `bun run check` passed (exit 0, no warning) until
the rule was named. Even at the top level, the plugin's rules are `warn`, and a warning does not fail
`vp check`. The five rules are the ones that name a bug: `jsx-key`, `jsx-no-duplicate-props`,
`jsx-no-undef`, `no-children-prop` and `rules-of-hooks`, each `error`.

**A web app that is not `api` is a React app.** A `web` module's id is free (`many`), so the glob is
`apps/*/**` and the one app that is not React is excluded by name: `api` is fixed by 035. Oxlint
overrides take `excludeFiles`, which is what makes that possible.

**What it still costs.** An app that is not React and not `api` (a `testing` module, say) is linted
with the `react` plugin; its files have no JSX, so the rules have nothing to report.

## What this module does not do

- `knip` and its `knip.jsonc` wait for the first patch type (`scripts.merge`): a root `package.json`
  edit is a patch, and `add` refuses patches today.
- It does not run the gate on `bg add`: spec 050 step 15 is not implemented, so `checks` is printed.
  `bun run golden` runs it.
