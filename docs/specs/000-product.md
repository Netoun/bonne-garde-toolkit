# 000 — Product

## Objective

Bonne Garde is a single-repo platform that vendors a full-stack Cloudflare/Bun boilerplate as composable pieces:

1. an empty base monorepo;
2. a CLI that creates projects and composes modules later;
3. two catalogs — a **shadcn-compatible UI registry** and a **Bonne Garde module registry** for full-stack features.

## Personas

| Persona             | Goal                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| Registry maintainer | Author, validate, and publish items and modules from this repository       |
| Consumer developer  | Scaffold an empty project, add only what they need, own the resulting code |

## Vocabulary

| Term             | Meaning                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Empty / base** | A Bun monorepo with tooling and conventions, and **zero** apps, features, or UI components                                          |
| **Item**         | A shadcn registry entry (`registry:ui`, `registry:lib`, …). Pure file vendoring — see [030](./030-ui-registry.md)                   |
| **Module**       | A Bonne Garde full-stack unit typed by **category**, installed into its own workspace package — see [035](./035-module-registry.md) |
| **Category**     | The slot a module fills (`auth`, `db`, `email`, …), carrying **cardinality** and **home**                                           |
| **Peer**         | A category (optionally an allow-list of module ids) a module needs installed                                                        |
| **Variant**      | An install-time payload of a module, selected by matching the installed peers                                                       |
| **Adapter**      | A _runtime_ provider inside a vendored package (`memory` / `cloudflare`) — never an install-time concept                            |
| **Patch**        | A named, typed, idempotent structural edit to an existing file — see [060](./060-patches-and-regions.md)                            |
| **Intent**       | A markdown intention executed by a human or supervised agent — see [065](./065-intentions.md)                                       |
| **Manifest**     | `bg.json` in a consumer project — installed items/modules, regions, registries, scope                                               |

## Three tiers of change

Every change a module makes to a consumer project declares exactly one tier.

| Tier           | Mechanism                           | Agent? | Reversible     | Use for                                      |
| -------------- | ----------------------------------- | ------ | -------------- | -------------------------------------------- |
| **1 `copy`**   | Verbatim file vendoring             | no     | yes (checksum) | New files the module fully owns              |
| **2 `patch`**  | Named codemod owning a **region**   | no     | yes (region)   | Structural edits to files the project owns   |
| **3 `intent`** | Markdown intention, human-confirmed | yes    | no             | What tier 2 cannot express, and all upgrades |

**Normative:**

- A module with zero tier-3 changes MUST install with no agent in the loop.
- Tier 2 MUST be preferred over tier 3 whenever a named patch can express the change.
- A failed tier-2 patch MUST degrade to a tier-3 intent, never to a silent skip or a hard failure of the whole install.

## Success metrics

- `bun create bonne-garde@latest my-app --yes` produces an installable empty monorepo without prompts.
- After `bg add api email`, the project typechecks and tests pass for the added surface.
- `bg add` works on an existing project created earlier (post-init composition).
- `bg doctor` reports drift between `bg.json` and the tree without network access.
- Installed code has no Bonne Garde runtime dependency.

## Journey

```text
create → write bg.json → add items/modules → execute pending intents → edit freely → add more → upgrade
```

## Normative requirements

- MUST ship `create`, `add`, `list`, `search`, `view`, `record`, `doctor` in v1. `remove` and `replace` follow immediately — they are what `files` + `regions` were built for ([060](./060-patches-and-regions.md)) — and `upgrade` after that ([090](./090-upgrades-and-intentions.md)).
- MUST vendor files into the consumer tree (no locked runtime).
- MUST remain opinionated: Bun, Cloudflare, Elysia, Drizzle/D1, Better Auth, React Router.
- MUST NOT ship apps or modules inside the base template.
- MUST NOT fork the shadcn registry schema for UI items.
- MUST NOT express full-stack composition inside the shadcn schema — modules use the native schema of [035](./035-module-registry.md).

## Single repository (normative)

CLI, base template, UI registry, module registry, and migration intentions MUST live in **one** repository and move under **one** semver / git tag — see [070](./070-testing-and-release.md). A separate registry repository would produce two tags for one platform state, which is exactly the drift lockstep forbids.

## Platform versioning & upgrades

- MUST ship **migration intentions** per release so diverged consumer projects can upgrade — see [090](./090-upgrades-and-intentions.md).
- Migration intentions and module install intents MUST share one document format, one linter, and one executor protocol — see [065](./065-intentions.md).

## Out of scope (v1)

- Arbitrary stack matrix
- Community marketplace / private registries
- Composition web UI
- Automatic silent upstream merges / diff-only upgrades
- Full uninstall of tier-3 changes (tier 1 and 2 are revertible; tier 3 is not)
