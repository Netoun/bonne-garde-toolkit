# pwa/workbox

A service worker for the SPA. After `react-router build`, [Workbox](https://developer.chrome.com/docs/workbox) precaches the build output, and the app opens with no network.

Peers on `web/spa`. It writes static files, so it works on both providers.

## What it installs

- `packages/pwa` (`{{SCOPE}}/pwa`): `buildServiceWorker(dir)` and the `pwa-build` bin that wraps it (run with `tsx`).
- In `apps/spa/package.json`: the dependency on `{{SCOPE}}/pwa` and `"postbuild": "pwa-build build/client"`, so every `vp run build` of the SPA ends with the worker.

`pwa-build <dir>`, over the client build directory:

1. writes `register-sw.js`, which registers `/sw.js` on `load`, and inserts `<script src="/register-sw.js" defer>` in every `.html` file, once: running it again changes nothing;
2. generates `sw.js` and its Workbox runtime (`workbox-*.js`), precaching js, css, html, images, `webmanifest` and `woff2`, answering every navigation with the SPA's fallback page (`index.html`, else `__spa-fallback.html`), and taking over open tabs when a new worker is installed (`skipWaiting`, `clientsClaim`, outdated caches cleaned).

The HTML is changed first so that the HTML the worker precaches carries the registration script.

## The manifest

This module adds none. The web manifest is `config/branding`'s: it generates `site.webmanifest` from `branding.json` and the SPA links it (`faviconLinks`). Edit the name, colours and icons there.

## Development

`vp run dev` has no service worker: `postbuild` runs after a build only, so the dev server never registers one, and nothing is cached while you work. To try the worker, `vp run build` in `apps/spa`, then serve `build/client` over `localhost` (the container of `provider/dockerfile` does) and open it in the browser.

## Serving `sw.js`

A browser re-checks `/sw.js` on every navigation, so an update ships with a deploy. Its host must not hand it a long-lived cache header either: Cloudflare Pages serves static files with `max-age=0, must-revalidate`, and the `provider/dockerfile` server sets no `Cache-Control` on the SPA's files. If you put a CDN or reverse proxy in front, keep `sw.js` and the HTML out of its long-lived rules.
