# Migration intentions

Per-release upgrade intentions for consumer projects (see [`docs/RELEASE.md`](../docs/RELEASE.md)).

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
bun run bonne-garde -- intentions lint
```
