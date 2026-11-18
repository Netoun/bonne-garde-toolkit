# dev/portless

A local launcher that gives every app of the project a named HTTPS URL (`https://api.my-app.localhost`,
`https://spa.my-app.localhost`) instead of a port, and tells each app where the others are. With `--lan`
the same names are served under `.local`, so a phone on the same Wi-Fi reaches them over a trusted origin.
It replaces the `portless` registry item, which was hard-wired to four apps (`AppKey = "api" | "spa" |
"ssr" | "static"`); `dev` is a `many` category of the repo home, local launchers that are never on the
runtime path ([035](../../../../docs/specs/035-module-registry.md), [09](../../../../docs/plans/2026-10-sync/09-dissolution.md) row 19).

```bash
bunx bg add dev/portless
vp run dev:portless           # or: vp run dev:lan:portless
```

Starting or switching the portless proxy asks for `sudo` (it binds port 443 and trusts a local CA). Nothing
here touches `/etc/hosts` or the keychain by itself; portless does that when you start it.

## Peers and variant

None, and one `default` variant. The launcher does not ask which modules are installed: it reads the
project, so it fits any combination of `provider`, `api` and `web` modules, and a project with a single app.
It is provider-independent because what differs per provider is already in each app's own `dev` script
(`wrangler dev`, or the container's server), which is where it looks.

## What it writes

| File                                   | What it is                                                     |
| -------------------------------------- | -------------------------------------------------------------- |
| `scripts/dev-portless.ts`              | the launcher                                                   |
| `scripts/dev-portless.test.ts`         | its tests: the plan, the discovery, the dry run, with no proxy |
| `scripts/dev-portless.tsconfig.json`   | what the module's typecheck compiles: the two files above      |
| root `package.json`, `scripts`         | `dev:portless` and `dev:lan:portless` (`scripts.merge`)        |
| root `package.json`, `devDependencies` | `portless` 0.15.6, exact (`package.dependencies`)              |

The root `test` and `typecheck` scripts fan out to workspaces only, so they never reach a root script. The
module's `checks` do: `tsc --project scripts/dev-portless.tsconfig.json` and
`vp test scripts/dev-portless.test.ts`.

## Which apps, and how each starts

The apps are the directories `apps/<dir>` whose `package.json` has a `dev` script, in directory order. Each is
named `<dir>.<slug>`, the slug being the root package name without its scope, so all of them are subdomains of
one domain: same-site, and auth cookies keep flowing as in production. The launcher reads how to start an app
from its `dev` script, and runs it with the bins a package manager's `run` would give it: the app's
`node_modules/.bin`, then the root's, so it works the same under bun and pnpm.

| `dev` script starts with | Run as                                                     | Why                                                                                                           |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `wrangler`               | `sh -c 'exec wrangler … --port "$PORT" "$@"'` and `--var`s | wrangler ignores `PORT`, and a Worker reads its vars, not the process env                                     |
| anything else            | the script as it is                                        | portless recognises `react-router` and `vite` by name and injects `--port`; a server reads the `PORT` it sets |
| not one plain command    | `vp run dev`                                               | `&&`, `\|`, `$VAR`, quotes or an env prefix: the script is left alone                                         |

## What each app is told of the others

Every app gets `<DIR>_URL` and `VITE_<DIR>_URL` for each app of the project (`API_URL`, `SPA_URL`,
`VITE_API_URL`, …). Two names the shipped modules read do not follow from a directory, so they are aliases,
left out when the app they point at is not installed:

| Variable        | Value                                  | Read by                                    |
| --------------- | -------------------------------------- | ------------------------------------------ |
| `VITE_APP_URL`  | the `spa` app's URL                    | `web/static`                               |
| `R2_PUBLIC_URL` | the `api` app's URL + `/v1/media/file` | `storage/r2` (a Worker var, hence `--var`) |

A Worker gets these as `--var` flags (without the `VITE_` ones, which only Vite reads); every other app gets
them in its environment.

## See the plan without starting anything

```bash
tsx scripts/dev-portless.ts --dry-run          # the plan as JSON: dir, name, url, cwd, cmd, env
tsx scripts/dev-portless.ts --dry-run --lan
```

It needs neither portless nor a proxy, and the URLs it prints are those of a proxy with its defaults
(`.localhost`, or `.local` with `--lan`). A real run asks `portless get <name>` for each URL instead.
`bun run golden` compares this plan with the apps each configuration installs.

## Known limits

- **`ssr`'s `API_URL` is probably not reached.** `web/ssr` reads it from the Cloudflare context, so a Worker var
  of its own `wrangler.jsonc`, and the launcher passes it as a process variable, as the legacy item did.
  Unverified; `wrangler` may need `CLOUDFLARE_INCLUDE_PROCESS_ENV` to read it.
- **The first app's name probes the proxy mode.** The proxy is shared by every portless project and remembers
  whether it is in LAN mode, so a run in the other mode restarts it for every project that uses it.
- **No app takes the bare `<slug>.localhost`.** The legacy item gave it to `static`; every app is now a
  subdomain, whatever the set of modules.
