# Changelog

One lockstep version for the CLI, the base template, the registry and the migration intentions ([070](./docs/specs/070-testing-and-release.md)).

## 0.2.0

`bonne-garde` and `@bonne-garde/{cli,registry,schema}`: 0.1.0 → 0.2.0.

### CLI

- `bonne-garde create` asks for the package manager, the apps, the provider and the features (`--pm`, `--apps`, `--provider`, `--features`), and checks the set against the registry before it writes a file.
- A terminal view for `create` and `add`: menus, spinners, the intentions to hand to an agent, the next steps. `add` prints a summary on a terminal, and the same JSON as before to a pipe or under `--json`.
- The project installs with the package manager its `package.json` pins; a missing one is one line, and the files stay written.

### Modules

- New category `pm`, first in the table: `pm/bun`, `pm/pnpm`.
- `web/spa`, `web/ssr` and `web/static` install without the API.
- `provider/dockerfile`: one Node container for either package manager; it serves the SPA alone when the project has no API.
- Every module tests on Vitest and runs its scripts with tsx, on Node as on Bun.

### Intentions

- None added. `email/resend/wire-email-into-auth` is unchanged.
