# Sync 2026-10 — boilerplate ← batch · treashunt · keeper · lonestone

Audit of the three sibling repos, the conventions skill and slop-sweep, plus two plans
(backport + dependencies) for `bonne-garde-boilerplate@feat/platform-cli-registry`.

Produced 2026-10-29. **Items 0, 1, 2 and 3 of [03](./03-backport-plan.md) have since been applied**
(uncommitted); everything else is still a plan. `bun run verify` exits 0.

| File                                               | Content                                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [01-consumers.md](./01-consumers.md)               | What batch / treashunt / keeper have that the boilerplate does not, and the nine keeper defects this tree still carries |
| [02-conventions-slop.md](./02-conventions-slop.md) | State of the conventions skill + slop-sweep, and what to do about them                                                  |
| [03-backport-plan.md](./03-backport-plan.md)       | The backport plan, each item routed to a tier (root / template / module / patch / intention)                            |
| [04-deps-plan.md](./04-deps-plan.md)               | Dependency plan in five PRs, Elysia 2 verdict included                                                                  |
| [05-lonestone.md](./05-lonestone.md)               | Boilerstone harvest — the field lessons, not the design                                                                 |

## Verdicts up front

| Question                         | Verdict                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Elysia 2?**                    | **No.** `2.0.0-rc.1`, and Eden has no 2.x build — Eden is the blocker, not Elysia. Bump to `1.4.30`. Three named conditions to re-evaluate.                                                                                                    |
| Most urgent defect overall       | `auth.module.ts:29` builds a **new better-auth instance per request**. treashunt fixed it as _"prevent CPU limit exceeded"_ (`2640e15b`); keeper is a singleton; batch still has it. An active failure, not a latent one.                      |
| better-auth 1.6 → 1.7            | **Cheaper than it looks.** Both siblings' bumps touched only `package.json` — zero `apps/api/src` changes, no 1.7-specific auth-schema diff. Expect one `Buffer` typing clash from the `@types/node` bump instead.                             |
| Largest-diff dependency step     | **vite-plus 0.2.8 → 1.4.0** — the whole lint/fmt gate, shared with keeper. Mechanical, but its own PR, and whichever repo goes first writes the recipe.                                                                                        |
| Biggest blind spot               | `scripts/` — the code that publishes the platform — is neither typechecked nor tested, which spec 070 explicitly forbids. Wiring the tests is four lines; a trial typecheck surfaces ~10 errors, mostly in `apps/cli` and `packages/registry`. |
| Most urgent latent defect        | `use-auth-redirect.ts` carries keeper's pre-fix open-redirect sanitizer. Latent today (the sink is `navigate()`), live the moment this code is vendored into consumer projects and reaches a `callbackURL`.                                    |
| Release blocker found in passing | Spec 020 says `bg.json` `version` MUST be `2`; the schema and `templates/base/bg.json` emit `1`, in the v1 shape.                                                                                                                              |
| Release tooling                  | Take **release-please over Tegami** and amend spec 070 — `extra-files` makes CLI/tag lockstep declarative.                                                                                                                                     |
| Run slop-sweep now?              | No — the tree holds the whole platform WIP untracked. Commit it, do the cheap mechanical passes, then sweep scoped.                                                                                                                            |
| Conventions skill                | `elysia-react-router-conventions` is **off** in `~/.claude/settings.json`, and its repo table knows only batch + treashunt.                                                                                                                    |

## Reading order

`04` is independent and can ship first. `02` is cheap and raises agent quality on every later
task. `01` → `03` are one chain: `01` is the evidence, `03` is the decision. `05` is spec and CLI
work, not backports.

## Unresolved questions

1. **Spec workflow.** The three consumers use three different ones: `.specify` (treashunt),
   openspec (keeper), chisel/`.agents` (batch). Which — if any — should the base template ship?
2. **Legacy apps.** `apps/{spa,ssr,static}` carry 30+ unused dependencies (TipTap, virtual lists)
   inherited from treashunt. Clean them, or retire them into registry modules per spec 080?
   Cleaning code that is about to be deleted is waste; the plans assume retire, not clean — so
   [04](./04-deps-plan.md) PR 5 shrinks to `apps/api` if you agree.
3. **`bg.json` manifest version.** Spec 020 (normative, `version: 2`) against the schema and the
   template (`version: 1`). Which moves?
4. **Front tests.** The conventions skill mandates Vitest + RTL + MSW; this repo and keeper both
   dropped front tests. Record it as a project difference in the skill, or reinstate tests for the
   registry's UI modules?
5. **Who owns the shared skill.** `elysia-react-router-conventions` now describes four repos. Does
   it stay personal in `~/.claude/skills/`, or become a `registry:tooling` item the CLI installs?
6. **release-please or Tegami.** [05](./05-lonestone.md) recommends release-please; spec 070 names
   Tegami as preferred. Amending 070 is the cheap part — adopting `commitlint` with it is the part
   that changes every commit in all four repos.
7. **The `EMAIL` binding.** Both siblings send mail through Cloudflare's `send_email` binding, and
   `packages/emails` here already ships the provider. But `AGENTS.md` forbids "CF proprietary APIs
   outside bindings `DB` / `BUCKET`". Amend the rule to a three-binding allow-list, or stay on
   Resend? The answer decides whether [04](./04-deps-plan.md) PR 2 bumps `resend` or deletes it.
8. **One test in `apps/spa`?** The open-redirect fix (`sanitizeRedirectPath`) is a pure function
   with a table of attack strings, and it is the one piece of front code where a test pays for
   itself. This repo ships no front tests. Exception, or fix it untested?
