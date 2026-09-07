# Building and installing on an iPhone

Everything below the first section needs **macOS with Xcode**. It has not been
run — see [verification.md](verification.md) for what was and was not tested.

## What already exists

`ios/` is generated and committed. Capacitor 8 uses Swift Package Manager rather
than CocoaPods, which is why `npx cap add ios` and `npx cap sync ios` completed
on Windows. Nothing in it was hand-written.

- App name: **Nexus**
- Bundle identifier: **`com.nexus.personal`** — local project metadata, not a
  registered Apple identifier. Change it before signing if you prefer; it must
  be unique to you.
- Deployment target: **iOS 15.0** (as generated).
- Plugins wired: Browser, Filesystem, File Transfer, Share.

## On the Mac

```bash
npm ci
npm run build
npx cap sync ios        # `npx cap add ios` only if ios/ is missing
npx cap open ios
```

`cap sync` copies `dist/` into `ios/App/App/public` and refreshes the Swift
package list. Run it after every web change — Xcode builds the copy, not `dist/`.

In Xcode:

1. Resolve the real scheme rather than assuming one:
   ```bash
   xcodebuild -list -project ios/App/App.xcodeproj
   ```
2. Pick an installed simulator and build **without** signing first. That
   separates "does it compile and run" from "is my provisioning right".
3. Only then move to a device, where signing starts to matter.

## Privacy manifest

Apple requires a reason declaration for some Filesystem APIs. Take the exact
`NSPrivacyAccessedAPITypes` entries from the installed plugin's own
documentation (`node_modules/@capacitor/filesystem`), rather than copying a
value from elsewhere — the accepted reason codes change, and a wrong one is
rejected at upload rather than at build.

This app only writes into its own cache directory and shares from there.

## App Transport Security

The generated `Info.plist` has **no** ATS exception, and it should stay that
way. Every request this app makes is HTTPS to `api.rule34.xxx` or
`gelbooru.com`, and media comes from those same domain families.

`limitsNavigationsToAppBoundDomains` is deliberately **not** set. Capacitor only
honours it alongside a `WKAppBoundDomains` list in `Info.plist`, and that key
blocks Capacitor's own plugin injection. External navigation is already
prevented three other ways: the content security policy, opening source links
through the Browser plugin, and the absence of any `<a target="_blank">`.

## Signing and sideloading

Use your own Apple account and provisioning through whichever route you already
have. Nothing here buys a signing service or touches an Apple account.

How long an install lasts depends entirely on that route — a free personal team
certificate expires in days, a paid developer account in a year. That is a
property of the certificate, not of this app.

## What to check on the device

The browser tests cannot cover any of this. Work through it in order:

**Networking**
- Search on each source with no account configured.
- Add an account per source; confirm the request now carries it and the other
  source is unaffected.
- Deliberately enter a wrong key: expect "account details were rejected" and an
  Open settings button, not an empty grid.
- Airplane mode: expect a connection message and a Retry that works once you
  are back online.
- Switch source while a request is in flight; the stale reply must not land.

**Media**
- A still image, an animated GIF, and an MP4.
- A WebM, which iOS may not decode: expect the "could not be played" panel with
  a link out, not an endless spinner.
- Reels: scrolling pauses the previous video; leaving Reels stops audio.

**Files**
- Save a media file from the viewer; confirm it reaches the share sheet and the
  Files app.
- Cancel a share sheet: the app should say saved, not failed.
- Export a backup, then import it back.
- Import a deliberately corrupt JSON file: nothing may change.

**Layout**
- Portrait on a notched device, and with the keyboard open in search.
- Rotation, if you leave landscape enabled.
- The settings dialog scrolls internally and its close button is reachable.

**Persistence**
- Force-quit and reopen: favorites, tracked tags, settings and accounts survive.

Do not put source content screenshots or your API keys into anything you commit.
