---
id: email/resend/wire-email-into-auth
kind: install
domain: email
classification: migration
---

# Send auth's emails through {{SCOPE}}/email

## Goal

`packages/auth/src/mailer.ts` exports `mailer`, the one value `auth.module.ts` hands to Better Auth to deliver a verification email or a password reset. Make it `emailMailer` from `{{SCOPE}}/email`, so that those emails are rendered by the email package's templates and sent by its adapter: Resend, or the memory adapter under `NODE_ENV=test`.

## Why

Auth owns the `AuthMailer` interface and ships `mailer = unconfiguredMailer(apiLogger)`, which sends nothing and logs that it did not. The email module comes after auth in spec 035's order, so it wires itself into auth and auth never imports it first. `bg add` already did what 060's patch catalog can express: it declared `{{SCOPE}}/email` as a dependency of `packages/auth`. No patch replaces the initializer of an exported constant, and the import that goes with it would sit unused until that is done, so the whole edit to `mailer.ts`, the import included, is this intention's. `bg record` then marks `mailer.ts` with this intention's region, so the file reads as the project's and auth's own re-add keeps it.

## Applies When

- `mailer` in `packages/auth/src/mailer.ts` is still initialised with `unconfiguredMailer(`.
- `emailMailer` is not imported from `{{SCOPE}}/email` in that file.
- A project that signed up a user and got no verification email, because `requireEmailVerification` is on and nothing sent it, is the case this closes.

## Do Not Apply When

- `mailer` already is `emailMailer`, or an adapter the project chose for itself: record `--skip` and say which.
- The project replaced auth's `mailer.ts` with its own file: adapt the same edit there if it still exports `mailer`, else record `--skip`.
- A prior mailer (the legacy `apps/api/src/lib/email.ts` over the `resend` SDK) is what this replaces: it is not a reason to skip.

## Observable Gaps

- `grep -n "unconfiguredMailer(apiLogger)" packages/auth/src/mailer.ts` finds the initializer of `mailer`.
- `grep -n "{{SCOPE}}/email" packages/auth/src/mailer.ts` finds nothing: `emailMailer` is not imported.
- Done when `mailer` is `export const mailer: AuthMailer = emailMailer;`, `emailMailer` is imported from `{{SCOPE}}/email`, the file no longer calls `unconfiguredMailer(apiLogger)`, and the `apiLogger` import that only that call used is gone (import `emailMailer` in its place). `unconfiguredMailer` stays exported and untouched: auth's own test pins it.

## Out of Scope

- `RESEND_API_KEY`: the email module declared it in `.env.example`; set it where the runtime reads its secrets.
- The sender address: `createResendEmailProvider` takes a `from`, and its default is the brand's legal name at `noreply@example.com`, which Resend will not send from until a domain is verified.
- Any other file of `packages/auth` or of `apps/api`.

## Reference Paths

- `adapt` `packages/auth/src/mailer.ts` — read it first; replace the one initializer, import `emailMailer` where the import it leaves unused was, keep the rest as the project has it.

## Validation

- `cd packages/auth && bun run typecheck && bun run test`
- `cd packages/email && bun run typecheck && bun run test`
- `bun run check`
- A test that signs a user up through `createTestAuth({ mailer })` (`{{SCOPE}}/auth/testing`) with the `mailer` of `./mailer`, and reads `outbox` from `{{SCOPE}}/email/testing`, finds one email to that user whose link carries the verification token.

## Record Result

- Applied → `bg record email/resend/wire-email-into-auth`
- Skipped → `bg record email/resend/wire-email-into-auth --skip "<reason>"`
