# Nexus for iPhone

A standalone iPhone build of the Nexus interface, carrying **Rule34 and Gelbooru
only**. It keeps the desktop layout, the viewer, favorites, the vault, tracked
tags, For You, Reels and the settings that still apply — and it does not need
your PC running. Internet access is still required to fetch new posts.

This is a separate project. `C:\nexus` (the desktop site) is untouched.

## What is in it

| Kept | Dropped |
| --- | --- |
| Rule34, Gelbooru | F95Zone, Lewd.ninja |
| Home / For You, Explore, Reels, Keep Up, Vault | Local ZIP & folder import |
| Viewer, tags, likes, favorites, blacklist | AI chat and model downloads |
| Saved tags, search history, themes, grid size | Game viewer & game vault |
| Backup export / import | Browser extension bridge, PC connection |

For You is the same local weighted-tag recommendation the desktop has. Nothing
about it is AI, and it does no network call of its own.

## Running it on a desktop browser

```bash
npm install
npm run dev
```

The dev server is a **preview harness only**. In a browser the API calls go
through `fetch` and Rule34/Gelbooru will refuse them cross-origin; the packaged
app uses native HTTP instead, which is not subject to that. Use the browser for
layout and interface work, not as proof that networking works.

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Node unit tests (sources, parsers, network, storage, backup, files, navigation, packaging) |
| `npm run build` | Builds `dist/` with Vite |
| `npm run check` | Package boundary audit + dangling-call check |
| `npm run test:e2e` | Playwright suite in Chromium and WebKit |
| `npx cap sync ios` | Copies `dist/` into the native project |

## Accounts

Rule34 and Gelbooru accounts are **optional** and start blank. Enter them under
Settings, per source. They are:

- stored only on this device, in the app's own database;
- attached only to that source's own requests;
- never included in an export, never written to a log, never shown in an error.

They are **not** in the iOS keychain. Treat this as ordinary app-local data, not
an encrypted vault. Deleting the app deletes them along with everything else.

> If you have used the desktop site, its `app.js` had a Rule34 and a Gelbooru
> API key written directly into the source. Those were **not** copied here, and
> nothing in this project reproduces them. Rotate them on both sites when you
> get a chance — anyone who has seen that file has them.

## Backups

Export writes a JSON file and hands it to the iOS share sheet. Import accepts
**only this app's own export** (`"format": "nexus-ios"`). A desktop Nexus backup
is rejected on purpose: its saved posts are keyed by a bare numeric id with no
record of which booru they came from, so importing one would silently mix the
two vaults. The import is validated in full before anything is written, and
applied in a single transaction, so a bad file changes nothing.

## Building for the phone

See [docs/ios-build.md](docs/ios-build.md). It needs a Mac with Xcode. For what
has actually been verified and what has not, see
[docs/verification.md](docs/verification.md).

## Layout

```
index.html          the Nexus markup, minus the removed features
src/main.js         the single entry point
src/app.js          the retained interface controller
src/sources.js      r34/gel identity, request builders, response parsers
src/network.js      checked GET, error classification
src/platform.js     native CapacitorHttp vs. browser fetch
src/storage.js      IndexedDB: likes, hearts, tag_stats, preferences
src/backup.js       versioned export, validated import
src/files.js        Filesystem + FileTransfer + Share
src/navigation.js   validated external links
scripts/            the extraction scripts and the package audit
```

`scripts/extract-*.py` are the one-shot tools that produced `index.html`,
`src/app.js` and `src/styles.css` from the desktop originals. They are kept so
the derivation is reproducible and reviewable, not because they run at build
time.
