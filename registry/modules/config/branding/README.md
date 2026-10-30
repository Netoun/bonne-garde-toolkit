# config/branding

The branding every app imports: `packages/config`, with the typed constants (`displayName`,
`shortName`, `npmScope`, `publicOrigin`, `supportEmail`, `legalName`), the generator that renders
them from `branding.json`, and the favicons. Extracted from this repo's legacy `packages/config`,
root `branding.json`, `scripts/gen-branding.ts` and `assets/favicons`
([080](../../../../docs/specs/080-existing-code-migration.md)).

```bash
bunx bg add config/branding
```

## What it writes

Everything is under `packages/config/`: 035 lets a package-homed module write nowhere else.

| File                                              | What it is                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `package.json`                                    | `{{SCOPE}}/config`: the `exports`, the `typecheck` and `test` scripts |
| `tsconfig.json`                                   | extends the project's, covers `src` and `scripts`                     |
| `branding.json`                                   | the source of the constants; `npmScope` is the project's scope        |
| `src/branding.generated.ts`                       | generated from `branding.json`: do not edit by hand                   |
| `src/branding.types.ts`, `src/gen-branding.ts`    | the `Branding` type, the validation and the rendering                 |
| `src/gen-branding.test.ts`                        | its six tests                                                         |
| `src/index.ts`                                    | the public surface                                                    |
| `scripts/gen-branding.ts`                         | reads `branding.json`, writes `src/branding.generated.ts`             |
| `assets/favicons/favicon.svg`, `site.webmanifest` | the two favicon files the apps import                                 |

### Exports

| Subpath      | File                          |
| ------------ | ----------------------------- |
| `.`          | `./src/index.ts`              |
| `./branding` | `./src/branding.generated.ts` |
| `./assets/*` | `./assets/*`                  |

The apps import the favicons as `{{SCOPE}}/config/assets/favicons/favicon.svg`. Legacy imports them
as `@acme/assets/favicons/...` through a `tsconfig` `paths` entry into a root `assets/` directory,
which a module cannot ship (`web` modules rewrite that import).

## The root `gen:branding` script (tier 2)

The module adds one script to the project's root `package.json`, the first use of the
`scripts.merge` patch ([060](../../../../docs/specs/060-patches-and-regions.md)):

```json
"patch": [
  {
    "type": "scripts.merge",
    "file": "package.json",
    "scripts": { "gen:branding": "bun packages/config/scripts/gen-branding.ts" }
  }
]
```

The key is added after the file's other scripts and nothing else in the file moves (comments,
indentation and line endings stay). Each key is a region, recorded in `bg.json`:

```json
"regions": { "package.json": { "scripts.gen:branding": "config/branding" } },
"modules": { "config": [{ "id": "branding", "patches": [
  { "type": "scripts.merge", "file": "package.json", "status": "applied" }
] }] }
```

`bg add` prints what each patch did, per module and per region, so a caller does not have to read the file:

```json
"patches": [{ "type": "scripts.merge", "file": "package.json", "status": "applied",
              "regions": [{ "region": "scripts.gen:branding", "status": "applied" }] }]
```

| Situation                                                             | Result                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| the script is absent                                                  | `applied`, region recorded                                                           |
| present and equal to the declared command                             | `skipped` (a second `bg add` changes no file; only `installedAt` moves in `bg.json`) |
| present and different (you edited it, or it was already yours)        | `bg add` fails and lists it; `--force` overwrites                                    |
| the region is owned by another module                                 | `bg add` fails; `--force` does not bypass it                                         |
| `package.json` is missing, is not JSON, or `scripts` is not an object | `failed` with its reason; the rest of the install goes ahead                         |

**A `failed` patch is recorded and reported, not converted.** 060 turns it into a pending tier-3
intention that the executor resolves (065). Staging intentions does not exist yet, so today the
failure is in four places and nowhere else: the `status`/`reason` in `bg.json`, `patches[].status`
and the top-level `failedPatches` in `bg add`'s JSON, a `bg: PATCH FAILED ...` line on stderr, and a
`patch-failed` warning in `bg doctor` (which `--strict` turns into a failure). Making the edit by hand
is the fix until the conversion is built.

`bg doctor` reads the region by region: the script is still there, and still what this module declares.

## What differs from legacy

The files are the legacy files byte for byte (080: no rewrites), with `{{SCOPE}}` where the scope
sits (`name`, `npmScope`), and two differences that follow from where a module may write:

- `branding.json` and the generator live inside the package. The generator is the legacy
  `scripts/gen-branding.ts` with its paths moved; `module-contract.test.ts` pins exactly which lines.
- `package.json` has no `devDependencies`: `typescript` is the project root's, as for `ui/shadcn`.

## Known gaps

- **The seven binary favicons are not carried**: `favicon.ico` and the PNGs (`favicon-16x16`,
  `favicon-32x32`, `favicon-48x48`, `apple-touch-icon`, `android-chrome-192x192`, `-512x512`). A
  template is read as UTF-8 and rendered as text, so a binary would be corrupted, and `bg.json` hashes
  the text. Nothing in legacy imports them (the apps import `favicon.svg` and `site.webmanifest`),
  and `site.webmanifest` points at root URLs that no app serves. They stay in `assets/favicons/` until
  the pipeline carries bytes.
- **`displayName` is "My App"**, not the project's name: `create` renders `{{DISPLAY_NAME}}` in the
  base files only. Edit `packages/config/branding.json` and run `bun run gen:branding`.
