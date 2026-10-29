# Specs — Bonne Garde platform

Normative specs for the composable full-stack boilerplate platform.

| Spec                                                               | Topic                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [RESEARCH.md](./RESEARCH.md)                                       | Benchmark (Stanza, Boilerstone, our POC, create-\*) and locked decisions |
| [000-product.md](./000-product.md)                                 | Product vision, vocabulary, **the three tiers**                          |
| [010-base-template.md](./010-base-template.md)                     | Empty template                                                           |
| [020-project-manifest.md](./020-project-manifest.md)               | `bg.json` (v2)                                                           |
| [030-ui-registry.md](./030-ui-registry.md)                         | shadcn UI catalog — tier 1 only                                          |
| [035-module-registry.md](./035-module-registry.md)                 | Native module catalog — categories, peers, variants                      |
| [040-cli-create.md](./040-cli-create.md)                           | `bg create`                                                              |
| [050-cli-add.md](./050-cli-add.md)                                 | `bg add` / list / search / view / doctor / remove                        |
| [060-patches-and-regions.md](./060-patches-and-regions.md)         | Tier 2 — patch catalog, region ownership, checksums                      |
| [065-intentions.md](./065-intentions.md)                           | Tier 3 — shared intention format for install **and** upgrade             |
| [070-testing-and-release.md](./070-testing-and-release.md)         | Tests, lockstep release, publish                                         |
| [080-existing-code-migration.md](./080-existing-code-migration.md) | Migration from the full monorepo                                         |
| [090-upgrades-and-intentions.md](./090-upgrades-and-intentions.md) | Consumer upgrades                                                        |

## Reading order

New to the model: `000` → `035` → `060` → `065`. Everything else is detail hanging off those four.
