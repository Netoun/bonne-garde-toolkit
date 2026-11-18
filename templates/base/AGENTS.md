# AGENTS.md

Empty Bonne Garde project (`{{SCOPE}}`).

- Package manager: the one `packageManager` names in `package.json`, and no other: `bun run <script>` in a Bun project, `pnpm run <script>` in a pnpm one, from the root or from a package. Scripts and tests run on Node either way (Vite+, tsx)
- Add modules: `bg add <item>`
- Do not invent stack choices outside installed registry items
- Before working in an app or a package, read its `AGENTS.md` if it has one (`apps/<app>/AGENTS.md`, `packages/<package>/AGENTS.md`)
