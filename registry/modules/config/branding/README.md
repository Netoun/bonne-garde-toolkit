# config/branding

The branding every app imports: `packages/config`, with the typed constants (`displayName`,
`shortName`, `description`, `lang`, `themeColor`, `backgroundColor`, `npmScope`, `publicOrigin`,
`supportEmail`, `legalName`), the generator that renders them and the web manifest from
`branding.json`, and the favicons. Extracted from this repo's legacy `packages/config`,
root `branding.json`, `scripts/gen-branding.ts` and `assets/favicons`
([080](../../../../docs/specs/080-existing-code-migration.md)).

```bash
bunx bg add config/branding
```

## What it writes

Everything is under `packages/config/`: 035 lets a package-homed module write nowhere else.

| File                                           | What it is                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                                 | `{{SCOPE}}/config`: the `exports`, the `typecheck` and `test` scripts                                                                                               |
| `tsconfig.json`                                | extends the project's, covers `src` and `scripts`                                                                                                                   |
| `branding.json`                                | the source of the constants and of the manifest; `npmScope` is the project's scope                                                                                  |
| `src/branding.generated.ts`                    | generated from `branding.json`: do not edit by hand                                                                                                                 |
| `src/branding.types.ts`, `src/gen-branding.ts` | the `Branding` type, the validation and the rendering                                                                                                               |
| `src/gen-branding.test.ts`                     | its twelve tests, among them the one that holds `site.webmanifest` to what the generator renders                                                                    |
| `src/index.ts`                                 | the public surface                                                                                                                                                  |
| `scripts/gen-branding.ts`                      | reads `branding.json`, writes `src/branding.generated.ts` and `assets/favicons/site.webmanifest`                                                                    |
| `assets/favicons/*`                            | the favicons: `favicon.svg`, `favicon.ico`, the PNG sizes, the touch icon and the two Android icons, and `site.webmanifest`, which names those two and is generated |

### Exports

| Subpath      | File                          |
| ------------ | ----------------------------- |
| `.`          | `./src/index.ts`              |
| `./branding` | `./src/branding.generated.ts` |
| `./assets/*` | `./assets/*`                  |

The apps reach the favicons as `{{SCOPE}}/config/assets/favicons/<file>`. Legacy imported them as
`@acme/assets/favicons/...` through a `tsconfig` `paths` entry into a root `assets/` directory, which a
module cannot ship (`web` modules rewrite that import).

The seven binaries (`favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`,
`apple-touch-icon.png`, `android-chrome-192x192.png`, `android-chrome-512x512.png`) are the first binary
template files ([035](../../../../docs/specs/035-module-registry.md)): copied byte for byte, recorded
in `bg.json` by the sha256 of their bytes, checked by `bg doctor` like any file.

`web/spa` serves this directory from the site root (its `vite.config.ts` sets `publicDir` to it), so
`/site.webmanifest` and the `/android-chrome-*.png` it names are in the build, and `root.tsx` links the
icons by those URLs. Golden reads the built `index.html`, finds the manifest and checks that every icon
it names is a file of the build.

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

The manifest is the one file that is not the legacy one: `site.webmanifest` was a static file with
`"lang": "fr"` and an empty `description`, and `gen:branding` now renders it. `branding.json` gained the
four keys it needs, `description`, `lang`, `themeColor` and `backgroundColor`, which are `branding`
constants too; the two icons, the display mode and the other fixed members are in `renderWebManifest`.

## Known gaps

- **`web/ssr` and `web/static` do not serve the manifest's icons.** They import `favicon.svg` and
  `site.webmanifest` through the bundler, which inlines both as `data:` URLs (observed on the `web/spa`
  build before it was changed): a `data:` manifest cannot resolve `/android-chrome-*.png`, and neither
  app links the PNGs. Each already owns a `public/` (`robots.txt`), and Vite takes one `publicDir`, so
  pointing it at the favicons would drop that file: they need the favicons merged into `public/`, which
  is not decided.
- **`displayName` is "My App"**, not the project's name: `create` renders `{{DISPLAY_NAME}}` in the
  base files only. Edit `packages/config/branding.json` and run `bun run gen:branding`.
