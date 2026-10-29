# Migration intentions

Per-release upgrade intentions for consumer projects (see [`docs/specs/090-upgrades-and-intentions.md`](../docs/specs/090-upgrades-and-intentions.md)).

Layout:

```text
migrations/
  TEMPLATE.md
  vX.Y.Z/
    README.md
    00-slug.md
    01-….md
```

Validate with:

```bash
bun run bg -- intentions lint
```
