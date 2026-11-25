# storage/fs

Media uploads over a directory, for the dockerfile provider: the same `/v1/media` routes, `medias` table and
exports of `{{SCOPE}}/storage` as [`storage/r2`](../r2/README.md), with the files written to
`<DATA_DIR>/media/<key>`. It is a module of its own, not a variant of a module titled "Cloudflare R2", as
`db/libsql` sits beside `db/d1`: no extra service, and the files live on the container's data volume, next to the
database.

```bash
bunx bonne-garde add provider/dockerfile config/branding api/elysia db/libsql orm/drizzle auth/better-auth storage/fs
```

## Peers

| Peer       | Allow-list    | Why                                                                                              |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------ |
| `provider` | `dockerfile`  | `readRuntimeEnv` from `{{SCOPE}}/api-runtime` gives `DATA_DIR` and `APP_URL`; there is a disk    |
| `db`       | `libsql`      | `readLibsql()` from `{{SCOPE}}/db/libsql`: the media record lives in the project's SQLite file   |
| `orm`      | `drizzle`     | `createDB` from `{{SCOPE}}/db` and the test database from `{{SCOPE}}/db/testing`                 |
| `auth`     | `better-auth` | the `auth` macro guards the routes, and `medias` has foreign keys onto `user` and `organization` |

One default variant. `storage/r2` there is refused (`storage/r2 accepts only cloudflare for provider`), and
`storage/fs` is refused on Cloudflare: a Worker has no disk.

## What it writes

Everything in `packages/storage`. `schema.ts` and `media.contract.ts` are those of `storage/r2` (the second
imports its types from `storage.ts`, where `r2.ts` has them); a contract test compares them.

| File                   | What it is                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/bucket.ts`        | `MediaBucket` (`put`, `get`, `delete`), `createFsBucket(root)` over `node:fs/promises`, and `readBucket()`             |
| `src/storage.ts`       | `R2Error`, `detectImageType`, `validateFile`, `validateKey`, `generateKey`, `publicUrlFor`, `uploadFile`, `deleteFile` |
| `src/env.ts`           | `resolvePublicUrl`: `<APP_URL>/v1/media/file`, and `resolveMediaSecret`                                                |
| `src/signed-url.ts`    | `signMediaUrl` and `verifyMediaSignature`: the short-lived urls of private media                                       |
| `src/media.service.ts` | `createMediaService(context)`: `uploadMedia`, `deleteMedia`, `getMediaById`, `getFile`                                 |
| `src/media.module.ts`  | `mediaModule`, which `apps/api` mounts, and `resolveRuntimeStorage()`                                                  |

`R2Error` keeps its name and its codes (but `BUCKET_NOT_CONFIGURED`: a directory is always there), so code written
against one storage module runs against the other.

An upload is checked on its content, as in `storage/r2`: the first bytes must be a JPEG, PNG, GIF or WebP that
matches the declared type, else `400 INVALID_FILE_TYPE`; `medias.mime_type` holds the detected type, and the file
route sends `X-Content-Type-Options: nosniff`.

Access follows the media's author and organization, as in `storage/r2`: an upload to an organization needs
membership (`403 UNAUTHORIZED` otherwise), a media is read by its author or a member of its organization (`404`
for anyone else), and deleted by its author or an `owner` or `admin` of the organization stored on the row. The
file route stays public by its random key for a public media.

A media can be private: `visibility` (`public` by default, in the upload body and in `medias.visibility`) set to
`private` keeps it off the public cache. `GET /v1/media/file/<key>` then answers `404` unless the url carries a valid,
unexpired `?expires=<unix seconds>&signature=<hex>`, and serves the file with `Cache-Control: private, max-age=<seconds
left>`; a public media, and its url, are unchanged. `GET /v1/media/:id` (same access rule as above) returns, for a
private media, a `url` signed at that moment, valid for 15 minutes, and so does the upload response; `medias.url`
keeps the plain url. The signature is the HMAC-SHA-256 of `<key>\n<expires>` (`signed-url.ts`, Web Crypto only) under
a key derived from the `BETTER_AUTH_SECRET` auth already owns (HMAC of the label `bonne-garde:media-url`), so no key
is added to the environment, and it is compared in constant time. Rotating `BETTER_AUTH_SECRET` invalidates the
urls in flight, and nothing else.

A media that another row points at cannot be deleted, and the database says so: a table of the project or of a module
that references `medias.id` with a plain `references()` (no `onDelete`) blocks the delete, `cascade` or `set null` let
it through, and that is the referencing table's choice. `deleteMedia` deletes the row first; a `FOREIGN KEY constraint
failed` anywhere in the error chain (D1 and libsql word it that way) answers `409 MEDIA_IN_USE` and the file stays.
The file is removed only after the row is gone.

## Where the files are

`<DATA_DIR>/media/<key>`, with `DATA_DIR` read as `db/libsql` reads it (`.data` by default, `/data` in the
container). The directory is created on the first upload. A key is `medias/<folder>/<uuid>.<ext>`, random, with the
extension of the detected type (`jpg`, `png`, `gif`, `webp`): the client's filename stays in `medias.name`.

Every key goes through `validateKey` (no `..`, no empty segment, so no absolute key, no backslash, no control
character), and `createFsBucket` then refuses any key whose path already holds a symbolic link, so a link placed
under the directory cannot lead a read, a write or a delete out of it. A write never overwrites a file. A delete
removes a file, never a folder.

The content type is the `medias.mime_type` the upload recorded, not something stored with the file: a file nobody
recorded is served as `application/octet-stream`.

## Public url

`medias.url` is `<APP_URL>/v1/media/file/<key>`: the API and the front share `APP_URL`, which
`provider/dockerfile` owns, so this module declares no environment key. A url is stored, so changing `APP_URL`
later leaves the urls already written pointing at the old origin.

## Not here

- **S3 or MinIO.** A bucket service is another module; this one is the single-instance default (the container is
  one instance: files and database share one volume).
- **Enriched storage and secure upload** (BG-37): the behaviour is that of `storage/r2`, nothing more.
- **`db:reset`.** The libsql variant of `orm/drizzle` has none; the files under `<DATA_DIR>/media` are not part of
  any reset.
- **`create`.** `--features storage` does not pick this module yet; `bonne-garde add storage/fs` does.
