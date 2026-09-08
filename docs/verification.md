# Verification status

What was actually run, and what was not. Recorded 2026-09-07 on Windows 11,
Node v22.18.0, from `C:\nexus-ios`.

Nothing below was run against a real Rule34 or Gelbooru account, and no test
fetches real source content. Every source endpoint is stubbed with invented
benign fixtures.

## Passing

| Gate | Command | Result |
| --- | --- | --- |
| Unit tests | `npm test` | **93 passed, 0 failed** across 8 files |
| Production build | `npm run build` | **succeeded**, 27 modules, `dist/` 21.5 kB html + 36.2 kB css + 70.9 kB js |
| Package audit | `npm run check` | **clean on source and dist**; scanner self-test caught its 2 planted violations |
| Dangling calls | `npm run check` | 98 methods defined, 90 call sites, **all resolved** |
| Encoding | `node scripts/check-encoding.mjs` | **clean**, no stray control characters |
| Browser suite | `npm run test:e2e` | **90 passed, 0 failed** (45 tests × Chromium 153.0.8010.12 and WebKit 26.6) |
| Native project generation | `npx cap add ios`, `npx cap sync ios` | **succeeded on Windows** — Capacitor 8 uses Swift Package Manager, so no CocoaPods or macOS was needed |

The browser suite runs against the **built** bundle served by `vite preview`,
not the dev-server module graph.

### What the browser suite actually covers

Gateway limited to two sources; invalid `?m=` falling back to the gateway with
no request fired; deep links; search first page at `pid=0`; sort reaching the request in each source's own spelling; pagination advancing without repeating a page; genuinely empty
results distinguished from failures; malformed / blocked / 401 / 429 / 500
responses each producing their own message with Retry or Open settings; retry
succeeding; a failed page preserving the loaded grid; latest-query-wins with a
slow earlier request; autocomplete including the "unavailable" state; the vault
showing one source at a time with the same numeric id saved on both; Keep Up
rows; Reels filtering to playable video; the blacklist; viewer next/previous;
hostile tags rendering as text; unplayable media offering the source; settings
opening with no network; accounts saving, surviving a reload, clearing, and
attaching only to their own source; grid size and theme surviving a reload;
valid and invalid backup import; search history. Plus, at 390×844 and 320×568:
no horizontal document overflow, 44 px minimum tap targets, the settings dialog
scrolling internally, the viewer close button reachable, and the grid-size
preference still changing the column count.

Security assertions: no remote script loads, no global `app` or `DB`, an
injected inline script is refused by the policy, no inline event handler exists
after rendering hostile tags, `javascript:` and off-domain media never reach an
element, no request touches a desktop backend or an image proxy, the source link
opens without navigating the app, and an API key never appears in any message
shown to the user.

## Not verified

These need a Mac and a device. **None of them has been run.**

| Gate | Status |
| --- | --- |
| Xcode compile | **not run** — needs macOS |
| Simulator run | **not run** |
| Native HTTP against the real sources | **not run** |
| Real account authentication, rate limiting | **not run** |
| Media playback and codec support on device | **not run** |
| Download / share sheet / Files integration | **not run** — plugin behaviour is mocked in tests |
| Safe areas, keyboard, rotation on hardware | **not run** — only emulated viewports |
| Signing, provisioning, sideload install | **not run** |

`docs/ios-build.md` has the device checklist.

### What the passing tests do not prove

- **Native networking.** In the browser the app uses `fetch`; on device it uses
  `CapacitorHttp`. The tests exercise the adapter's contract with injected
  transports, not the real native implementation. Native HTTP bypasses the web
  view's cross-origin rules — it does **not** bypass authentication, rate
  limits, source blocks, hotlink policy or codec support.
- **Plugin behaviour.** Filesystem, File Transfer, Share and Browser are mocked.
  The tests prove the ordering, the one-download guard, the cancellation paths
  and that no base64 blob crosses the bridge. They do not prove the plugins
  behave that way on iOS.
- **Layout on hardware.** `env(safe-area-inset-*)` resolves to 0 in a desktop
  browser, so the safe-area handling is written but unexercised. The viewport
  assertions ran at iPhone dimensions, not on an iPhone.
- **Anything about a signed app.** No IPA has been produced. This is a source
  and native project, not an installed application.

## Deliberate decisions worth reviewing

- **Desktop backups are rejected.** Their saved posts carry a bare numeric id
  with no source, and Rule34 post 42 is not Gelbooru post 42. Guessing would
  merge the two vaults, so the import refuses rather than migrate. There is no
  automatic migration path, by design.
- **`backupData()` was implemented, not preserved.** The desktop code binds an
  Export button to a method that does not exist anywhere in its `app.js`.
  Keeping the button would have kept a dead control.
- **The embedded API keys were not copied.** The desktop `app.js` carries a live
  Rule34 and Gelbooru key in source. They were blanked before anything was
  written here, and they appear in no file, fixture, log or commit in this
  project. They should still be rotated at the source — this project cannot do
  that for you.
- **Accounts are app-local, not keychain-encrypted.** Stated plainly in the
  README rather than implied to be more protected than they are.
- **No public CORS or image proxy.** The desktop fell back to `wsrv.nl` for
  failed thumbnails; that route is gone rather than reproduced.

## Bugs found and fixed during verification

Each was caught by a test rather than by reading:

1. **Two downloads could start at once.** The single-download guard was set
   after the first `await`, so two taps in the same tick both got past it.
2. **Unplayable video spun forever.** A `<video>` with a `<source>` child
   reports failure on the source element; the handler was only on the video.
   This would have shown as a permanent spinner on the device.
3. **`Browser.then()` is not implemented on web.** Returning the Capacitor
   plugin proxy straight out of an `async` function made `await` treat it as a
   thenable. Opening a source link raised an uncaught error.
4. **The grid collapsed to 2 px.** With the filter sidebar removed, the explore
   row was still a flex column with `align-items: flex-start`, so its only child
   took its width from content. Every card was 2 px wide.
5. **The grid-size preference did nothing on a phone.** All three desktop track
   sizes collapsed to one column at 390 px. Rescaled so small/medium/large give
   three/two/one columns.
6. **`limitsNavigationsToAppBoundDomains` was set without its precondition.**
   Capacitor only honours it alongside a `WKAppBoundDomains` list, which itself
   blocks plugin injection. Removed after checking the documentation; it would
   likely have surfaced only as a broken device build.
7. **Storage credential guards threw synchronously** from an otherwise
   promise-returning API, so a `.catch()` caller would have missed them.
