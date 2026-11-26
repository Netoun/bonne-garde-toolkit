# email/resend

Transactional email over the project's provider: a react-email kit themed from the project's branding, the
templates auth needs (verification, password reset, organization invitations and magic links) rendered to html and
plain text in English and French, a `memory` adapter for tests, and a transport per provider: Resend over its HTTP API, and SMTP
(nodemailer, Mailpit in development) on `dockerfile`. It is the legacy
`packages/emails` and `apps/api/src/lib/email.ts` extracted into `packages/email`.

```bash
bunx bonne-garde add provider/cloudflare config/branding api/elysia db/d1 orm/drizzle auth/better-auth email/resend
```

## Peers and variants

| Peer       | Allow-list | Why                                                                                 |
| ---------- | ---------- | ----------------------------------------------------------------------------------- |
| `provider` | any        | `readRuntimeEnv` from `{{SCOPE}}/api-runtime` reads the key; the provider owns that |
| `config`   | `branding` | `branding.legalName` and `formatEmailFrom` from `{{SCOPE}}/config`, for the sender  |

Resend is plain HTTP, so it works under both providers; SMTP is the self-hosted counterpart and exists
only on `dockerfile` (ADR 0009, shape a). There is one module, `email/resend`, because the `email`
category admits one: the provider picks the transport through variants, not through a second module.
**It does not peer on `auth`.** 035 has no optional peer, and an email module that refused to install
without auth would be an email module for one consumer. It has four variants instead, and the installed
peers pick one, the most specific that matches (050 step 7); no two are ever equally specific:

| Variant                  | `match`                                           | What it adds                                                                                    |
| ------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `default`                | `{}`                                              | the package with the Resend transport, and nothing else: no patch, no intention                 |
| `better-auth`            | `{ auth: "better-auth" }`                         | the same package, a patch into `packages/auth`, and the intention that finishes it              |
| `dockerfile`             | `{ provider: "dockerfile" }`                      | the package with the SMTP-or-Resend transport, SMTP's adapter and tests, Mailpit's compose file |
| `dockerfile-better-auth` | `{ provider: "dockerfile", auth: "better-auth" }` | the `dockerfile` package, and the auth patch and intention of `better-auth`                     |

The two of a provider write the same files, with the same dependencies and env (a contract test pins
that); the `dockerfile` ones copy more than the others. A project without auth (golden's
`dockerfile-postgres` configuration has none) installs `default` or `dockerfile`, and `bonne-garde doctor
--strict` is green as it is.

## Transports

The package exports `./transport`, a file of the variant (`jsonc.merge`, as `realtime/rooms` does for
`./driver`): `createTransport(env)` returns the adapter `runtime.ts` sends through.

| Provider     | File                    | What it sends through                                                             |
| ------------ | ----------------------- | --------------------------------------------------------------------------------- |
| `cloudflare` | `src/transport.ts`      | Resend; `RESEND_API_KEY` is required                                              |
| `dockerfile` | `src/transport.node.ts` | SMTP when `SMTP_URL` is set, else Resend when `RESEND_API_KEY` is, else it throws |

Cloudflare's `send_email` binding is not a transport: it delivers only to destination addresses the
account has verified, so it cannot send an auth email to a user. Cloudflare keeps Resend.

On `dockerfile` both keys are optional in `.env.example` and the first email needs one. `SMTP_URL` is
nodemailer's connection URL: `smtp://mailpit:1025` for Mailpit, `smtps://user:password@host:465` for a
relay. The sender is the same `defaultFrom` as Resend's, passed as `from` when you build the adapter.

### Mailpit

The `dockerfile` variants copy `packages/email/compose.mailpit.yaml`, a `mailpit` service
(`axllent/mailpit`, SMTP on 1025, the inbox on 8025). The provider's `compose.yaml` is not edited: ADR
0009 says the dockerfile default adds no service. Run it beside it, with `SMTP_URL=smtp://mailpit:1025` in
the project's `.env`:

```bash
docker compose -f compose.yaml -f packages/email/compose.mailpit.yaml up
```

Read the mail at <http://localhost:8025>.

## What it writes

Everything in `packages/email`, from explicit paths:

| File                                       | What it is                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                             | `{{SCOPE}}/email`: the `.`, `./testing` and `./transport` exports, the scripts                                                         |
| `src/types.ts`, `render.ts`, `send.ts`     | `EmailMessage` (`to`, `subject`, `html`, `text`), `EmailProvider`, `renderEmailTemplate` (returns `{ html, text }`) and `sendEmail`    |
| `src/components/email-kit.tsx`             | `EmailLayout`, `EmailHeading`, `EmailText`, `EmailButton`: the frame and parts every template is built on, themed from `branding`      |
| `src/templates/*.template.tsx`             | `VerifyEmailEmail`, `ResetPasswordEmail`, `InvitationEmail`, `MagicLinkEmail` and `WelcomeTemplate`, on the kit, each taking `locale?` |
| `src/messages/{en,fr,index}.ts`            | the strings of every email per locale, `EmailLocale`, `DEFAULT_EMAIL_LOCALE` and `emailMessages(locale)`                               |
| `src/preview.ts`                           | `writePreviews(outDir?)`: every template × locale to static `html` and `txt` files and an `index.html`; the `preview` script           |
| `.gitignore`                               | `.preview/`, where the preview script writes                                                                                           |
| `src/providers/memory.provider.ts`         | `createMemoryEmailProvider(store)`: keeps what it is asked to send, sends nothing                                                      |
| `src/providers/resend.provider.ts`         | `createResendEmailProvider({ apiKey, from?, baseUrl? })`: `POST /emails`, plain `fetch`                                                |
| `src/providers/smtp.provider.ts`           | `dockerfile` only: `createSmtpEmailProvider({ url, from? })`, nodemailer, `html` and `text`                                            |
| `src/env.ts`                               | `resolveEmailEnv`: `RESEND_API_KEY`, read from `readRuntimeEnv()`                                                                      |
| `src/transport.ts`, `transport.node.ts`    | `createTransport(env)`: Resend (`cloudflare`), or SMTP then Resend (`dockerfile`); the `./transport` export is the variant's           |
| `compose.mailpit.yaml`                     | `dockerfile` only: a `mailpit` service for development                                                                                 |
| `src/runtime.ts`                           | `emailProvider`: the adapter the runtime sends through, chosen at the first email                                                      |
| `src/auth-mailer.ts`                       | `createAuthMailer` and `emailMailer`: auth's two emails, rendered and sent                                                             |
| `src/testing.ts`                           | `outbox` and `clearOutbox`: what the memory adapter holds under test                                                                   |
| `src/*.test.ts`, `src/providers/*.test.ts` | the tests that travel, and the new ones: no mock of `fetch`, no snapshot                                                               |

Dependencies are exact: `@react-email/components` (it re-exports `render`, so the package pins one renderer),
`react` and `react-dom` (`react-dom` is a peer of the renderer), and the project's `api-runtime` and
`config` as workspaces. `@types/react` is the dev one. The `dockerfile` variants add `nodemailer`, and
`@types/nodemailer`, `smtp-server` and `@types/smtp-server` for the tests: they run a real SMTP server in
process, so nothing is mocked.

## The kit, and the theme

`EmailLayout` is the `<html lang>`, head, preview text, body and a centred container, with the brand's
name above the content and the support address under it. It reads `branding` from `{{SCOPE}}/config`:
`displayName` in the header and footer, `themeColor` for the brand name, the button and the links,
`backgroundColor` for the page, `supportEmail` in the footer. `<html lang>` and the footer's wording follow the
template's `locale`, not `branding.lang`: an email's language is its recipient's. A project
restyles its emails by editing `branding.json`; the kit has no key of its own. Styles are inline (mail
clients ignore classes and `<style>` unevenly), so there is no Tailwind in the package.

A template is a function of its props returning an `EmailLayout`: `VerifyEmailEmail`,
`ResetPasswordEmail`, `InvitationEmail`, `MagicLinkEmail` and `WelcomeTemplate` keep their names and props, and a new one
sits beside them the same way. `renderEmailTemplate` renders it twice, to `html` and, with
`plainText: true`, to `text`; the button's link is in both. Every `EmailMessage` carries both parts, and
Resend gets them as `html` and `text` in one request.

## Languages

The package owns its strings: `src/messages/en.ts` holds every subject, heading, body, button and footer
line, and `fr.ts` is typed against the shape of `en` (`EmailMessages`), so a key missing from French is a
type error, not an English line in a French email. There is no i18next and no peer on the `i18n` module
(still being built, BG-36); the locale identity, `"en" | "fr"` with `en` the default, is the one that
module chose, so the API's resolved locale can be passed straight in later.

Every template takes `locale?: EmailLocale` and so does each message auth hands the mailer
(`AuthEmailMessage`, `AuthInvitationMessage`, `AuthMagicLinkMessage`); absent means English. Auth passes none today: wiring the
request's locale into it is not done here.

```ts
await renderEmailTemplate(VerifyEmailEmail, { name: "Ada", verificationUrl, locale: "fr" });
await emailMailer.sendPasswordReset({ to, name, url, locale: "fr" }); // French subject and body
```

**Adding a locale.** Create `src/messages/<code>.ts` exporting `const <code>: EmailMessages` (the compiler
lists what is missing), add the code to `EMAIL_LOCALES` (it defines `EmailLocale`) and the file to `MESSAGES` in `messages/index.ts`. The preview renders it with no other change.
Subjects and templates need no change.

## Preview

```bash
cd packages/email && vp run preview   # then open .preview/index.html
```

`src/preview.ts` renders every registered template in every locale, with its sample props, to
`.preview/<template>.<locale>.html` and `.txt`, and an `index.html` linking them. It is a script, not a
react-email dev server (`email dev` pulls Next.js), run with `tsx` so it works under any package manager.
`.preview/` is git-ignored by the package. Each template exports its sample props beside it
(`verifyEmailPreviewProps`, …); previewing a new template means exporting its props and adding one `entry(...)`
line to `PREVIEWS` in `preview.ts`.

## Resend, and why not the SDK

The legacy API sent through the `resend` SDK with `react: <element>`, and the SDK renders it. This
package renders to `html` itself (`render` from `@react-email/components`, which stage 1 of the kit pinned) and posts
`{ from, to, subject, html, text }` to `https://api.resend.com/emails` with `fetch`. That is the whole of
what the project used, it has no SDK to bundle for Workers, and it can be tested against a real HTTP
server: `resend.provider.test.ts` starts a `node:http` server that answers as Resend does and points
`baseUrl` at it. A `User-Agent` is set explicitly, because Resend answers 403 without one and `fetch` on
Workers sends none. A non-2xx answer is thrown as `Email send failed: <status> <Resend's message>`; the
key is never in it.

**The sender.** `from` defaults to what the legacy code used: the brand's legal name at
`noreply@example.com`, an address Resend will not deliver from until a domain is verified. A deployed
project passes its own, `createResendEmailProvider({ apiKey, from })`; there is no env key for it
(the legacy code had none, and adding one is a feature, not an extraction).

## Which adapter, and what a missing key does

`emailProvider` is chosen when the first email is asked for, not at import:

- under `NODE_ENV=test` it is the memory adapter, writing to `outbox` from `{{SCOPE}}/email/testing`;
  nothing reaches the network, and the environment is not read;
- anywhere else it is the variant's transport (see Transports), configured from `readRuntimeEnv()`. **A
  missing key throws, naming it** (on `dockerfile`, naming `SMTP_URL` and `RESEND_API_KEY`), and never
  falls back to memory: a production project would send nothing and say so nowhere.

So the project boots with no key (the legacy API exited at import without it) and the first email fails
loudly. A failed read is not remembered: set the key and the next email finds it.

| Provider     | Where the keys come from                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `cloudflare` | `.dev.vars` in `apps/api` for `wrangler dev`, `wrangler secret put RESEND_API_KEY` when deployed     |
| `dockerfile` | `SMTP_URL` or `RESEND_API_KEY` in the project's `.env`, which `compose.yaml` passes to the container |

The module declares `RESEND_API_KEY` in `.env.example` (`required` on `cloudflare`, optional on
`dockerfile`, with `SMTP_URL`). A key belongs to the module that reads it (035), so neither provider
declares it any more, and a contract test refuses a second declarer.

On `dockerfile`, `compose.yaml` names no module's key. It reads the project's `.env` through `env_file`
(Compose 2.24 or later), so the key has to be in that file, copied from `.env.example`: one exported only
in the host's shell does not reach the container, and `docker compose run -e` or `docker run -e` passes it
by hand ([`provider/dockerfile`](../../provider/dockerfile/README.md#compose-and-the-projects-env)).

## Wiring into auth (060, 065)

Email comes after auth in 035's order, so it wires itself into auth and auth never imports it first.
Auth owns the `AuthMailer` interface and exports `mailer`, documented as the one place an `email` module
wires itself in. The `better-auth` variant does it in two steps:

1. **One patch** (tier 2), which `bonne-garde add` applies: `package.dependencies` declares `{{SCOPE}}/email` in
   `packages/auth/package.json`.
2. **One intention** (tier 3), `email/resend/wire-email-into-auth`, which `bonne-garde add` stages in
   `.bg/add/` and which is pending until `bonne-garde record`: make `mailer` `emailMailer`, importing it from
   `{{SCOPE}}/email` in place of the `apiLogger` import only the old initializer used. This is the first
   intention a module ships: no patch of 060's closed catalog replaces the initializer of an exported
   constant, and an import patch on its own would sit unused, and fail `vp run check`, until the
   initializer is replaced. So `bonne-garde add` writes nothing into `mailer.ts`, and there is no lint-red window
   between `bonne-garde add` and `bonne-garde record`.

**What `bonne-garde record` does to `mailer.ts`.** It is auth's tier-1 file, with its sha256 recorded, and the edit
changes it: `bonne-garde doctor` would report it user-modified, a warning that `--strict` fails on. The intention
declares `mailer.ts` as an `adapt` Reference Path, so `bonne-garde record` records `intent[email/resend/wire-email-into-auth]`,
owned by email, on it. A file with recorded regions is checked by region (060), so `doctor` reads it as the
project's, and re-adding auth keeps the edit and reports it, even when auth's template changed. Auth's
recorded sha is not replaced by the edited file's: that would make auth's re-add see an untouched file
and overwrite the edit. Re-adding email skips its patch and stages nothing. `bonne-garde record --skip` records no
region. Golden checks all of it: no region before the record, the region after it, `doctor --strict`
green, and each module added again changing nothing.

What the executor does, and what golden does, the same way: read `.bg/add/session.md`, apply the edit the
document describes, run its Validation (`typecheck`, `test`, `check`, and a test that signs a user up
through `createTestAuth({ mailer })` and reads the `outbox`), then `bonne-garde record
email/resend/wire-email-into-auth`. Until then `mailer` is auth's own, which sends nothing and says so, and
the module's `checks` are withheld (050 step 15).

**Installed in the other order.** `bunx bonne-garde add auth/better-auth` after email is installed wires it all the
same: auth's install knows nothing of email, but `bonne-garde add` selects the variants of the installed modules
again (050 step 7), finds that the `better-auth` variant of email now matches, and plans email in the same
call as a re-add. It reports it (`bonne-garde: email/resend, installed on variant default, is planned again on
variant better-auth, which matches auth/better-auth`, and `reselected` in the JSON), applies the patch and
stages the intention, as one call naming both would. A project that is already in that state, from before
`bonne-garde add` did this, is fixed by `bunx bonne-garde add email/resend`. Golden installs auth first in its configurations, and
checks the other order in a project of its own.

## Not here

- **The Cloudflare `send_email`-binding adapter.** It delivers only to verified destination addresses of
  the account, so it cannot send auth emails to users; Cloudflare keeps Resend.
- **The `resend` SDK** and `apps/api/src/lib/email.ts`, which `apps/api` keeps while the legacy tree stands.
- **A use for `WelcomeTemplate`.** Nothing sends it; it is carried over with its test, as extracted.
- **An env key for the sender address.**
