# {{DISPLAY_NAME}}

A Bonne Garde monorepo. `bg.json` lists what is installed. `bunx bonne-garde add <name>` adds more, and `bunx bonne-garde list` shows what exists. Add modules with the CLI:

```bash
bunx bonne-garde add config/branding provider/cloudflare api/elysia ui/shadcn button   # or pnpm dlx bonne-garde add …
```

## Scripts

`vp run <script>`, or the `run` of the package manager `package.json` names:

- `check` — format + lint (Vite+)
- `typecheck`
- `test`
- `dev`
