# 065 — Intentions (shared format)

## Objective

Define **one** intention document format, linter, and executor protocol, used by two producers:

| Producer                | Scope                                              | Id shape                        |
| ----------------------- | -------------------------------------------------- | ------------------------------- |
| Module install (tier 3) | Wiring a module into code the project owns         | `<category>/<module-id>/<slug>` |
| Platform upgrade        | Replaying a release change into a diverged project | `vX.Y.Z/<slug>`                 |

An intention declares the **meaning** of a change — goal, applicability, observable gaps, validation — never a diff. A human or supervised agent replays the smallest safe equivalent locally. The CLI stages and records; it MUST NOT rewrite application code itself.

## Why not a free-text prompt

A prompt tells an agent what to do. An intention is _auditable state_: it has an id, it is linted, its outcome is recorded in `bg.json`, and `doctor` can prove whether it was resolved. A `PROMPT.md` with no frontmatter and no record cannot be checked, so a project silently drifts from what the module assumed.

## Layout

```text
registry/modules/auth/better-auth/intent/
  01-wire-auth-into-api.md

migrations/
  TEMPLATE.md
  v0.2.0/
    README.md
    01-align-bun-pin.md
```

| Rule           | Detail                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| Filename       | `NN-slug.md` — the `NN-` prefix **is** execution order                      |
| Id             | Frontmatter `id`, never containing `NN-`                                    |
| Requires       | Optional `requires:` list; staging MUST refuse missing deps                 |
| Release README | Migration releases MUST list their ids; `bg intentions lint` fails if stale |

## Frontmatter (MUST)

```yaml
---
id: auth/better-auth/wire-auth-into-api
kind: install # install | migration
domain: auth # category for install, capability/domain for migration
classification: migration # informational | migration | breaking-manual
requires:
  - auth/better-auth/create-session-table
---
```

| Field            | Rules                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| `id`             | `<scope>/<slug>` where scope is a module path (`install`) or `vX.Y.Z` (`migration`) |
| `kind`           | Selects the recording surface in `bg.json`                                          |
| `domain`         | Used to filter intentions against what the project actually tracks                  |
| `classification` | `breaking-manual` MUST stop the executor                                            |
| `requires`       | Ids that MUST appear earlier in execution order                                     |

## Sections (MUST)

- **Goal / Why** — the target end state and its rationale
- **Applies When / Do Not Apply When** — observable conditions. A prior stack being migrated away from is an **apply** signal, never a skip reason
- **Observable Gaps** — greppable, binary done-when
- **Out of Scope**
- **Reference Paths** — each path declares `copy` (take verbatim) or `adapt` (diff first, replay the meaning, preserve project deltas)
- **Validation** — commands to run after applying (a module's `checks` land here)
- **Record Result** — how to mark applied or skipped

## Recording

Outcomes live in `bg.json` ([020](./020-project-manifest.md)), same shape for both kinds:

```json
"modules": {
  "auth": [{ "id": "better-auth", "variant": "default",
             "intentions": { "applied": ["auth/better-auth/wire-auth-into-api"], "skipped": {} } }]
},
"platform": {
  "intentions": { "applied": ["v0.2.0/align-bun-pin"], "skipped": { "v0.2.0/adopt-x": "capability not installed" } }
}
```

- `applied` is a list of ids; `skipped` is a map id → human reason.
- An intention MUST NOT be recorded before its Validation passes.
- `bg doctor` MUST report every staged-but-unresolved intention.

## Executor protocol (normative)

Identical for install and upgrade:

1. Read the staged checklist — `.bg/add/session.md` for install, `.bg/upgrade/session.md` for upgrade.
2. **Propose** apply or skip per pending intention, citing observable signals — then wait for human confirmation before any edit or record.
3. One confirmed intention at a time. Diff Reference Paths first; never retype from memory.
4. Run the intention's Validation plus the project's `typecheck` / `test` / `check` as applicable.
5. `bg record <id>` and one commit per intention.
6. Stop and write `blocked.md` beside the session file on `breaking-manual`, failed validation, or an unconfirmed decision — do not record.

**Fail-closed:** staging refuses a dirty worktree; `bg upgrade finish` refuses to advance `platform.version` while any intention in range is neither applied nor skipped.

`.bg/` is the scratch root — gitignored and disposable. No state persists until a `record`; `bg.json` is the only durable surface.

## Linting

`bg intentions lint` MUST validate, for install and migration alike:

- filename shape and unique order prefixes within a scope;
- frontmatter presence, id agreement with path and slug, known `kind` / `classification`;
- `requires` resolvable and strictly earlier in order;
- required sections present;
- every Reference Path declaring `copy` or `adapt`;
- migration release READMEs listing every id in that release.

CI MUST run it before tagging.

## Acceptance

- One parser and one linter cover `registry/modules/**/intent/` and `migrations/**`.
- A module install intent and a release migration intent differ only by `id` scope and `kind`.
- `bg doctor` distinguishes applied, skipped, and pending intentions.
- An intention whose Validation fails is never recorded.
