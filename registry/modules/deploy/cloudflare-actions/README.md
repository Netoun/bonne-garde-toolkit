# deploy/cloudflare-actions

The project's `.github/workflows/deploy.yml`, and the script that decides what it deploys. One
workflow for every combination of `api` and `web` modules, because it does not name an app: the script
reads the tree.

```bash
bunx bg add provider/cloudflare deploy/cloudflare-actions
```

## Peers and variant

| Peer       | Allow-list   | Why                                                             |
| ---------- | ------------ | --------------------------------------------------------------- |
| `provider` | `cloudflare` | it runs `wrangler`, which only the Cloudflare modules configure |

035 asks a `deploy` module for one variant per provider it supports. This one supports Cloudflare, so
there is one, `cloudflare`. A project on the `dockerfile` provider is refused, naming the provider; its
pipeline is a module of its own.

## Why the workflow is data-driven

A workflow with one job per app would need one file per combination of `api`, `spa`, `ssr` and `static`,
and 060 has no YAML patch to add a job when a `web` module is installed later. Instead the workflow has
two jobs that never change, and `scripts/deploy-cloudflare.ts` plans the deploy from the tree on every run.

An app is a directory under `apps/` with a `wrangler.jsonc` and a `deploy` script in its `package.json`.
The modules that installed the app own both (`api/elysia`, `web/spa`, `web/ssr` and `web/static` each ship a
`wrangler.jsonc` and patch in `deploy`), so adding or removing one of them changes what is deployed
with no edit here. `bg.json`'s `apps` is not read: it stays empty after the app-homed modules install.

## What it writes

| File                                | What it is                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `.github/workflows/deploy.yml`      | `validate`, then `deploy`; runs `workflow_dispatch` only                             |
| `scripts/deploy-cloudflare.ts`      | `planDeploy`, `buildVars`, `deploy` and the command; no dependency, Bun's own parser |
| `scripts/deploy-cloudflare.test.ts` | its tests, over fixture trees in a temp directory; no test starts a process          |

One patch: `scripts.merge` adds `deploy:cloudflare` (`bun scripts/deploy-cloudflare.ts`) to the root
`package.json`, which is what the workflow and you call. It declares no dependency, no workspace and no
env key: a key belongs to the module whose code reads it, and the two secrets are GitHub's, named only
in the workflow.

`checks` runs the script's tests. The project's `bun run test` does not reach `scripts/`, which is not
a workspace, so that check is where they run.

## The plan

For a project with `api/elysia`, `db/d1` and the three `web` modules:

```text
build   apps/api      bun run build
build   apps/spa      bun run build
build   apps/ssr      bun run build
build   apps/static   bun run build
migrate apps/api      bun run db:migrate:remote --env production
deploy  apps/api      bun run deploy --env production
deploy  apps/spa      bun run deploy --project-name <name in its wrangler.jsonc> --branch main
deploy  apps/ssr      bun run deploy --env production
deploy  apps/static   bun run deploy --project-name <name in its wrangler.jsonc> --branch main
```

```bash
bun run deploy:cloudflare --dry-run    # this, as JSON: nothing runs, no credentials, no network
```

- **Every build comes before the first migration or deploy**, so a build that fails stops the run with
  nothing changed on Cloudflare. `validate` runs the dry run too, so a config that cannot be deployed
  fails before the job that holds the secrets starts.
- **The app with a `db:migrate:remote` script goes first** (`db/d1` adds it to `apps/api`), migrated
  immediately before its deploy; the others follow by directory name.
- **A Worker** is deployed with `--env production`, **a Pages app** (a `pages_build_output_dir` in its
  config) with its own `name` as the project and `main` as the branch. The `name` is read, not written
  twice: Pages requires it at the top level of the config, "because environments target the same
  project", and `--branch` is what picks the production deployment.
- Every step runs with `CLOUDFLARE_ENV=production`. The config `web/ssr` builds carries the
  environment it was built for, and wrangler 4.119 (read in its source) refuses an `--env` that
  differs from it, so `--env production` after a `CLOUDFLARE_ENV=production` build agrees with it.
  `wrangler pages deploy` refuses the `--env` flag, which is why a Pages app is given none, and
  reads `CLOUDFLARE_ENV` like the others: it selects the config's `env.production`, the only
  environment names Pages accepts being `preview` and `production`.
- It stops at the first step that fails, and says which.

Each `wrangler.jsonc` has to have a `name`, a `main` or a `pages_build_output_dir`, and an
`env.production`, or the plan fails naming the file. Without it wrangler fails when the config
defines other environments, and when it defines none only warns, then deploys the top-level values:
the `localhost` URLs.

## Build-time variables

A front reads its API URL at build time (`VITE_API_URL`: `web/spa` throws at load without it), and the
workflow cannot name it without owning a key that belongs to `web/spa`. So the deploy step passes
`VARS_JSON: ${{ toJSON(vars) }}`, the variables of the `cloudflare` GitHub environment, and the script
hands each **build** those whose name starts with `VITE_`, the only ones Vite puts in a bundle. A
deploy step gets none, and neither does anything else: a variable that is a secret by mistake, or
`API_URL`, which a Worker reads from its `wrangler.jsonc`, is not forwarded. The dry run prints the
names it would forward, never the values.

### A build that lacks one is refused

A front built without its API URL deploys, and is broken: `web/spa` throws at load. So the script reads what
each app it builds needs, and **refuses before the first build** (nothing runs, nothing changes on Cloudflare)
when a variable is not there:

```text
deploy: a build is missing a variable it needs, and would ship a front that fails at load: apps/spa needs
VITE_API_URL; apps/static needs VITE_API_URL. Set each one as a variable of the `cloudflare` GitHub environment ...
```

What an app needs is the `VITE_*` members of `interface ImportMetaEnv` in its `src/vite-env.d.ts` that have no
`?`: the file `web/spa` and `web/static` ship to type what their build reads. The script names no variable and no
app, so a front that reads another one, or a module that drops one, changes the refusal with no edit here. A member
with a `?` is optional and not asked for (`web/static`'s `VITE_APP_URL` is declared in its `env` as
`required: false`, and is not in its `vite-env.d.ts`); `web/ssr` declares none, since it reads `API_URL` from its
Worker config at run time. A value counts as missing when it is empty. A variable in the environment of a local run
counts too, since a build is given that environment.

The dry run lists what each build needs (`requiredBuildVars`, names only). It **refuses only when it is handed
variables**, that is when `VARS_JSON` is set: the `validate` job runs it with none, because the variables of the
`cloudflare` environment are the `deploy` job's, so there is nothing there to compare with. The real run, in the
`deploy` job, is the one that always checks.

## Turning it on

It is `workflow_dispatch` only, as the legacy workflow was, until these exist:

1. A GitHub environment named `cloudflare`, with the secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`, and the variables the builds need (`VITE_API_URL`: the run is refused without it), set to the
   production URLs.
2. In each `wrangler.jsonc`, the `my-app` placeholders replaced: the Worker and Pages project names,
   the `env.production` routes and URLs, and `db/d1`'s name and `database_id`
   (`bunx wrangler d1 create <name>` gives the id).
3. The Pages projects and the D1 database created under those names.
4. The Workers' own secrets, which this does not set: `BETTER_AUTH_SECRET` (`auth/better-auth`) and
   `RESEND_API_KEY` (`email/resend`) with `bunx wrangler secret put <KEY> --env production` in
   the app that reads them.

To deploy on every green CI run on `main`, uncomment the `workflow_run` trigger at the top of the
workflow and put the name of the project's CI workflow where `CI` is. The repo has none to name: this
module installs no CI workflow.

## What it changes from the legacy workflow

The repo's own `deploy.yml` had a job per app. Here:

| Legacy                                          | Here                                           | Why                                                         |
| ----------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| One job per app, in parallel                    | One `deploy` job, apps in order                | which apps exist is read from the tree, not written in YAML |
| Builds inside each deploy job                   | Every build before any deploy                  | a failed build can no longer leave the API deployed alone   |
| `bun run verify`                                | `check`, `typecheck`, `test`, then the dry run | a generated project has no `verify` script                  |
| `environment: cloudflare` on every job          | On `deploy` only                               | `validate` holds no secret, and an approval gate asks once  |
| Secrets in the job's `env`                      | In the one step that deploys                   | `bun install` does not see them                             |
| 15 minutes per job                              | 30 for the one job                             | it holds every build and deploy                             |
| `--project-name my-app-spa` written in the YAML | Read from the app's `wrangler.jsonc`           | one name to change, not two                                 |

What it keeps: `workflow_dispatch` only with the CI-gated trigger commented, `concurrency` on
`deploy-production` that never cancels, the `cloudflare` environment, `actions: read` and
`contents: read`, and the same action SHAs.

## What is proved, and what is not

Golden installs it on the `cloudflare` configuration and checks, with no account and no network, that
`deploy.yml` parses, that the dry run's plan is exactly the list above and every app in it exists with
a valid `wrangler.jsonc`, that the dry run names the one variable the builds need (`VITE_API_URL`, for the
SPA and the static site, and none for the Worker) and refuses variables that lack it, that re-adding it changes
nothing and `bg doctor --strict` is green, and that the `dockerfile` configuration refuses it, naming the
provider. **No deploy has been run**: the commands
are the legacy workflow's, but this workflow has never talked to Cloudflare.
