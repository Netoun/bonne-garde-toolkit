# pm/pnpm

pnpm installs the project, and Node runs everything: scripts (`tsx`), tests (`vp test`), Vite+. Every
project has one `pm` module, which `bg create` adds from its first question (`--pm pnpm`, the default when
`create` was started from pnpm) ([035](../../../../docs/specs/035-module-registry.md),
[040](../../../../docs/specs/040-cli-create.md)).

## What it writes

| File                                  | What it is                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| root `package.json`, `packageManager` | `pnpm@12.17.0`, exact (`jsonc.merge`); `bg add` and `bg create` install with it       |
| `pnpm-workspace.yaml`                 | the base's workspaces (`apps/*`, `packages/*`), and `strictDepBuilds: false` (below)  |
| `.github/actions/setup/action.yml`    | the CI setup: pnpm at that pin, Node for Vite+ and tsx, the install, the bins on PATH |

## Dependencies that ship an install script

esbuild (tsx, Vite, wrangler), workerd (wrangler, Miniflare) and msw (the fronts' tests) each ship one, and
the project works without running them. pnpm runs none it was not told to trust, and pnpm 12 fails the
install on them by default; `strictDepBuilds: false` makes it list them instead. `pnpm approve-builds`
allows the ones you choose.

## In the container

`provider/dockerfile`'s image installs pnpm at this pin (`npm install --global`), installs with it and
runs the API on Node, as it does for a Bun project.
