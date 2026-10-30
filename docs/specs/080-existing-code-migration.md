# 080 — Existing code migration

## Objective

Extract the legacy monorepo — and fold in the `bonne-garde-registry` POC — into the two catalogs, without drive-by refactors.

## Sources

| Source                                       | Fate                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Legacy `apps/*`, `packages/*` in this repo   | Extracted into modules, or into feature items ([030](./030-ui-registry.md)), then deleted per item |
| POC `bonne-garde-registry`                   | Folded in: `template/` trees, patch catalog, `PROMPT.md` → intents, `doctor`                       |
| Current `registry/` (shadcn `meta.bg` items) | UI items keep their files; `meta.bg` dropped; app/lib items become modules                         |

The POC's patch implementation (`jsonc-parser` + `ts-morph`) is the **starting point** for the tier-2 catalog, not a second implementation to reconcile later.

## Order (MUST)

1. `tooling` module + base template alignment, then `config` (the branding constants every shell imports)
2. `ui` module (host package) + UI items, `meta.bg` removed
3. App shells: `api`, then `web` (spa / ssr / static)
4. `db` + `orm`, then `auth`
5. `email`, `queue`, `storage`
6. Delete a legacy app/package **only** after the generated playground is green for the module that replaces it

`web/ssr` declares `peers.provider: ["cloudflare"]` (step 3). A `dockerfile` project has no SSR shell, and a second SSR variant is a new feature, not part of this extraction.

## Category assignment

Every extracted piece MUST be assigned a category from [035](./035-module-registry.md), or an item kind from [030](./030-ui-registry.md) (UI or feature), before extraction starts. A piece that fits neither is a signal the table is wrong — fix the table, do not invent a field.

## Rules

- MUST preserve behavior; no feature rewrites during extraction.
- MUST keep `test:platform` green throughout; `test:legacy` may lag ([070](./070-testing-and-release.md)).
- Module source lives under `registry/modules/<category>/<id>/template/`, mirroring the target tree.
- Consumer placeholders (`{{SCOPE}}`, `{{DISPLAY_NAME}}`) are rendered at copy time — never patched into project-owned files ([060](./060-patches-and-regions.md)).
- Every extracted module MUST declare its `peers`, at least one `variant`, and its `checks`.
- A `PROMPT.md` carried over from the POC MUST be converted to a linted intent ([065](./065-intentions.md)) — id, frontmatter, observable gaps, validation, record. A free-text prompt is not an intent.

## MVP extraction (this iteration)

- `tooling`, `ui` (host package) + `button` / `badge` / `card` / `utils` items
- `api` — minimal Elysia Worker shell (health route, entry, wrangler stub)
- `email` — from the POC, including its `memory` / `cloudflare` runtime adapters

## Done when

- MVP modules installable via `bg add`, non-interactively.
- Playground generated from base + MVP is green on typecheck, test, and `bg doctor --strict`.
- No `meta.bg` remains in the UI catalog.
- Specs remain the source of truth for further extractions.
