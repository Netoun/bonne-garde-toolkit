# pm/bun

Bun installs the project and runs its scripts. Every project has one `pm` module, which `bg create` adds
from its first question (`--pm bun`, the default when `create` was not started from pnpm), so the base
template pins no package manager ([035](../../../../docs/specs/035-module-registry.md),
[040](../../../../docs/specs/040-cli-create.md)).

## What it writes

| File                                  | What it is                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| root `package.json`, `packageManager` | `bun@1.4.2`, exact (`jsonc.merge`); `bg add` and `bg create` install with it         |
| `.github/actions/setup/action.yml`    | the CI setup: Node for Vite+ and tsx, Bun at that pin, the install, the bins on PATH |

The workspaces are the base's `package.json` `workspaces`, which Bun reads. Scripts and tests run on Node
whichever package manager the project has: `vp test` is Vitest, a module's scripts run with `tsx`.

## Who peers on it

`deploy/cloudflare-actions` peers on `pm: []`, so the setup action its workflow calls is there.
`provider/dockerfile` peers on none: its image installs with whichever `packageManager` names.
