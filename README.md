# E-mergency

Integrated multi-agency emergency response system for an LGU — a resident SOS app
and a dispatch command center in one installable, offline-capable Progressive Web App.

> **Prototype.** This is a working front-end simulation: there is no backend, and no
> report leaves the browser. In a real emergency, call your local hotline (911 in the
> Philippines) or your municipal MDRRMO / PNP / BFP station.

## What it does

**Resident app (left panel)**
- One-tap dispatch to PNP, BFP, MDRRMO/PDRRMO, Ambulance, or a multi-agency SOS
- KYC gate (ID + selfie + ordinance waiver) before any button can be pressed
- GPS and timestamp locked at the moment of the trigger — turning device location
  off afterwards does not erase the pinned report
- Optional, non-blocking photo/video evidence, watermarked with coordinates and time
- Silent panic mode for situations where a loud alarm is dangerous

**Command center (right panel)**
- Live tactical map with pins, agency stations and the nearest hospital
- "We are coming" acknowledgement that starts turn-by-turn responder navigation,
  mirrored on the resident's phone with a live ETA, plus a Google Maps deep link
- Per-agency views, PDRRMO escalation, hospital ER pre-arrival alert
- Anti-prank citation flow, audit stream, official blotter with CSV export

## PWA behaviour

| Capability | How it works |
|---|---|
| Installable | `manifest.webmanifest` with maskable icons, shortcuts and install-dialog screenshots. An **Install App** button appears when the browser offers a prompt; iOS gets Add-to-Home-Screen instructions. |
| Works offline | `sw.js` precaches the entire app shell (HTML, CSS, JS, fonts, icons) on install and serves it cache-first, so the app launches with no network. |
| Offline SOS queue | A report triggered with no signal is held on the device with its locked GPS and timestamp, kept out of the dispatch view, and transmitted automatically when connectivity returns (Background Sync, falling back to the `online` event). Delivery is never reported while offline. |
| Survives relaunch | Incidents, blotter, audit log and anything queued are mirrored to `localStorage`, so closing the installed app loses nothing. |
| Update flow | A new service worker shows a "New version ready" prompt instead of silently swapping the app mid-incident. |
| No CDN | Tailwind is compiled ahead of time, and fonts and icons are self-hosted — nothing the UI needs is fetched from a third party at runtime. |

Shortcut deep links: `?view=command`, `?view=resident`, `?panel=blotter`,
`?action=sos` (opens the SOS screen; it never dispatches on its own).

## Run it

A service worker needs `http(s)` — opening `index.html` from the filesystem will not install.

```bash
python3 -m http.server 8080
```

Then open <http://127.0.0.1:8080/>. To verify offline behaviour: load it once, then go
offline (DevTools → Network → Offline, or airplane mode) and reload — the app still runs,
and an SOS triggered there is queued until you reconnect.

## Deploy

Any static host works. For GitHub Pages: repository **Settings → Pages**, source
**Deploy from a branch**, pick this branch and the `/ (root)` folder. The manifest and
service worker use relative paths, so a project subpath (`/emergency/`) is fine.

## Layout

```
index.html              app shell and all UI logic
sw.js                   service worker: precache, offline fallback, sync
manifest.webmanifest    install metadata, shortcuts, screenshots
offline.html            fallback shown if the shell was never cached
assets/app.css          compiled Tailwind + self-hosted @font-face  (generated)
assets/lucide.min.js    44-icon subset of lucide, 10 KB             (generated)
assets/fonts/           Inter + JetBrains Mono variable woff2, 72 KB (generated)
icons/                  app, maskable, apple-touch and shortcut icons (generated)
screenshots/            install-dialog screenshots used by the manifest
build/                  Tailwind input + config for the CSS build
tools/                  regenerate the generated assets, and check-precache.py
tests/pwa-test.js       end-to-end PWA checks (Playwright)
.github/workflows/      CI: runs those checks in a real browser
```

## Rebuilding the generated assets

Everything marked *generated* above is built from `build/` and `tools/`; edit the
inputs, not the output.

```bash
npm install --no-save tailwindcss@3.4.17 lucide@0.544.0
```

```bash
npx tailwindcss -c build/tailwind.config.js -i build/input.css -o assets/app.css --minify
```

`build/input.css` starts with the Tailwind directives, then `build/fonts.css`
(the `@font-face` rules), then the app's own CSS — keep that order, since the
later rules are meant to win over utilities.

```bash
python3 tools/build-icons.py          # icon set (needs Pillow)
```

```bash
python3 tools/build-fonts.py          # re-download + subset fonts (needs fonttools, brotli)
```

```bash
node tools/build-lucide-subset.js     # icon bundle — rerun after using a new icon
```

`assets/lucide.min.js` contains only the icons referenced by `index.html`, so a
newly used `data-lucide` name needs this rerun or the icon will not render.
If the generated file list changes, update `PRECACHE_URLS` in `sw.js` to match,
and bump `VERSION` there so clients pick the new shell up.

## Tests

With the app served on `http://127.0.0.1:8080/`:

```bash
npm install --no-save playwright && node tests/pwa-test.js
```

28 checks covering the service worker and precache, offline launch, the offline
SOS queue and its flush on reconnect, session persistence across relaunch,
install affordances, manifest shortcuts, fonts and icons.

Two cheaper checks guard the things that only break offline, and are worth
running before you commit a change to the assets:

```bash
python3 tools/check-precache.py    # sw.js precaches exactly what ships
```

```bash
node tools/build-lucide-subset.js && git diff --exit-code assets/lucide.min.js
```

`.github/workflows/pwa.yml` runs all three on every push and pull request,
and uploads the suite's screenshots as a build artifact.
