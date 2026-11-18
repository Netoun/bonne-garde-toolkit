# apps/spa

React Router SPA. How to add to it; the root `AGENTS.md` still applies.

## Add a page

1. Create `src/features/<f>/pages/<f>-<name>-page.tsx`. A route with child routes is named
   `-layout.tsx`, and a route that only redirects, `-redirect.tsx`.
2. Declare it in the feature's fragment, `src/features/<f>/routes.ts`: a default export of route
   entries, with paths relative to `src`, such as
   `route("login", "features/auth/pages/auth-login-page.tsx")`.
3. Leave `src/routes.ts` as it is: it composes every fragment. A fragment that declares an index
   route replaces the home page.
4. Put the rest of the feature in `components/`, `hooks/` or `lib/`. The three suffixes above are
   reserved for routed files.

`vp run check` enforces this with the lint rule `structure/route-modules`, when the module
`tooling/vite-plus` is installed.

## Call the API

When the project has the API (`api/elysia`), use `api` from `src/lib/api.ts`, the Eden Treaty client
typed from it. Never call `fetch`.

## Build UI

Compose the primitives of `{{SCOPE}}/ui/components/<name>`. Never write a raw `<button>`, `<input>`,
`<select>` or `<textarea>`, or a `div` with a `role`. When a primitive is missing, add it with
`bonne-garde add <item>`.

## Done when

From the project root, `cd apps/spa && vp run typecheck && vp run test` passes.
