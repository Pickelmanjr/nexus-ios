# Nexus iPhone Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Deliver an isolated, credential-free, sideloadable iOS source project for Rule34 and Gelbooru with the recognizable Nexus interface and no running-PC dependency.

**Architecture:** Audit-copy the three website files into a Vite-built, vanilla-JavaScript Capacitor shell; retain the UI controller rather than rewrite the interface. Extract small source, transport, persistence, backup and native-file boundaries, with only `r34` and `gel` accepted throughout. Bundle all executable resources; native HTTP handles APIs, WKWebView loads validated media URLs, and native file/share plugins handle exports.

**Tech Stack:** Vanilla ES modules, Vite, Capacitor core/CLI/iOS plus official Browser, Filesystem, File Transfer and Share plugins; Node test runner, fake-indexeddb and Playwright Chromium/WebKit. Select mutually compatible released packages at implementation time, check Node/Xcode requirements, pin exact versions and commit the lockfile; this plan does not claim a latest version.

---

## Authority and work boundaries

Approved spec: `docs/superpowers/specs/2026-09-07-nexus-iphone-design.md`. User already said go: execute without another design approval question. This document is planning only; none of the runtime changes below have been made.

- All relative destination paths below are under `/mnt/c/nexus-ios` (`C:\\nexus-ios`). All commands run there unless explicitly marked Mac.
- `/mnt/c/nexus` is read-only source. Never copy its repository/history, backups, cookies, credentials or browser data. Never scan `image-ai`, dependencies or media directories recursively.
- Never publish, push, buy signing, access Apple credentials or generate a claim of an IPA from WSL.
- Preserve Home/FYP, Explore/search, Reels, Keep Up (tracked tags), Vault, settings, viewer, saved tags, blacklist and history for supported sources. FYP is local weighted-tag recommendations, not AI; do not remove it because of its name.
- Mac/Xcode build, native-network behavior, media compatibility, share sheet and actual signed installation are separate pending gates.

## Inspection-backed map and exact removal boundaries

The destination initially contains only `.git` and `docs`; git status was clean. Source references below refer to the original website's line positions; use named methods/DOM nodes once edits shift lines.

### Assets and HTML

`/mnt/c/nexus/index.html` has 739 reported lines. Its only script/style dependencies are `styles.css`, a timestamp-injected `app.js`, and CDN JSZip. The interface uses inline SVG and system fonts; CSS has only one data-URI SVG (in an excluded F95 select). **No source image/font/video directory is needed.** Remove JSZip entirely, not vendor it; replace the timestamp loader with `<script type="module" src="/src/main.js"></script>` and bundle styles locally.

Copy only the audited contents of `index.html`, `app.js`, `styles.css` into destination `index.html`, `src/app.js`, `src/styles.css`. Never first commit the raw JavaScript: both supported source configs contain hard-coded account IDs and API keys at original lines 278 and 283. Redact in memory before writing; do not reproduce values in docs, fixtures, logs or git. Do not use those keys for live tests. Flag separately that the original owner should rotate embedded keys; leave desktop untouched.

Remove HTML: F95 and Local gateway buttons (56–65); `#sidebar-toggle`; `#f95-sidebar` (134–298); `#local-zip-view` (313–370); `#nav-game-vault`; `#nav-local`; `#ai-chat-home` subtree (473–498); `#game-viewer` (694–737). Keep `#keep-up-view`, `#reels-view`, all booru navigation, settings and `#media-viewer`. Expand `#gel-settings-group` into per-source account settings, adding Rule34 equivalents and a gateway settings entry so credentials are reachable before search succeeds.

### JavaScript

- Replace `DB` (1–237): no extension message bridge, `bridgeActive`, `requestExt`, `putLocalBatch`, local-media branches, game stores or unused `following` store. `following` is created/migrated but no active feature uses it; tracked tags are the separate `tracked` list.
- Remove state `f95*`, `aiChat*`, `aiContextItem`, `localMedia`, `localGroups`, `localFilters`, `localPage`, `_pageTransition`; preserve shared pagination/viewer/search state.
- Configs (274–305): retain only endpoint definitions for `r34` and `gel`; credentials default empty. Remove `lewd` as well as F95 even though Lewd has no visible gateway card.
- `start` (307+): remove `bindF95SidebarEvents`, `bindAIChat`, `autoRecoverOldVault`, `_loadSavedLocalMedia` calls; await storage and settings before choosing an allowlisted URL mode. Delete `autoRecoverOldVault` (345–398) entirely: no implicit desktop-data migration.
- `bindEvents` (408–670): remove AI calls on source switching, game viewer handlers, local scroll/drop/ZIP/folder/filter/pagination handlers, F95 sidebar events, and local/game history branches. Preserve search, dialogs, preferences, tags, backup buttons and media-viewer controls.
- Delete the contiguous feature methods from `handleDrop` through `executeF95Search` (672–1784), including any differently formatted folder handlers in that span.
- Simplify `initMode`, `loadSettings`, `trackTags`, `executeSearch`, `nav`, `loadView`, `loadSmartHome`, `loadKeepUp`, `fetchKeepUpData` (1786–2431): remove every game/local branch; validate modes/views before DOM/history/storage mutation; always start booru pagination at zero.
- Replace `smartFetch` (2433–2556) and `smartFetchText` (4777–4804) with the shared adapter. Delete every proxy path, including `wsrv.nl` media fallback, not just localhost.
- Delete `fetchLewdData` and `fetchF95Data` (2558–2832). Refactor booru `fetchData` (2834–2997), `fetchKeepUpData`, autocomplete, count, category and Reels requests through the source module; no duplicated raw request construction.
- `renderCards` (3005–3230): remove game placeholders/card branch, `_favCacheGame`, game storage reads and game viewer dispatch; keep booru rendering. Audit all raw API values used in HTML templates.
- Delete `openGameViewer` (3232–3438), AI methods (3440–3542 and 3652–4160), `closeGameViewer` and `toggleGameFavorite` (4162–4198). **Do not delete 3543–3650:** `normalizeTagArray`, `escapeHTML`, category helpers/cache, `fetchTagCategory` and `hydrateViewerTagCategories` support the ordinary viewer despite sitting amid AI code.
- Preserve `prevMedia`, `nextMedia`, category rendering, `openViewer`, `closeViewer`, likes and favorites (4200–4530); remove all AI mounting/context/corner-button calls inside them. Replace raw ID identity with source-qualified identity everywhere, including DOM IDs, cache sets and current-post lookups.
- Autocomplete (4532–4692): remove game genres branch; retain saved-tag fallback but label remote failure rather than pretend it was a successful remote response.
- Replace `restoreData` (4695–4716). `backupData()` is referenced by a click listener but **has no definition in inspected app.js**: implement it; do not claim existing export works.
- `saveSearchHistory` (4864+): remove POST to `/api/track/search`; preserve local history. Simplify Reels (4919–5064) to source module calls and drop local/game branches. Preserve local reset-algorithm action, bounded to retained stores.

### CSS

Preserve root tokens, backgrounds/orb, system font stack, gateway/card/grid, top bar, bottom tabs, settings, viewer, chips, FYP, Keep Up and Reels styling. Remove selectors exclusive to `.f95*`, `body.f95-active`, `.gw-card.f95`, `.gw-card.local`, `.local-*`, `.delete-local-btn`, ZIP/dropzone, game-viewer/game-card/game labels/comments/downloads, `.ai-*`, `#ai-*` and viewer-AI controls. Original major clusters include F95 sidebar around 625–890, local styles around 1960–2010, F95 overrides from 2659 onward and AI styles later; do not delete broad ranges containing shared rules. Split mixed selector lists and retain shared declarations. Existing bottom safe-area padding is useful; top safe area and fixed `100vh` need correction.

## Minimal target architecture

```text
index.html + src/styles.css             existing Nexus DOM and visual tokens
  src/main.js                          imports CSS; initializes app once
  src/app.js                           retained UI controller (exported, no global app)
    src/sources.js                     r34/gel request builders, parsers, post identity
      src/network.js                   checked GET, JSON/text, error classification
        src/platform.js                explicit CapacitorHttp / browser fetch binding
    src/storage.js                     private IDB, transactional writes, hydration
    src/backup.js                      versioned allowlisted validation/import/export
    src/files.js                       Filesystem + FileTransfer + Share
    src/navigation.js                  validated external links via Browser.open
vite.config.js -> dist/                 only sanitized bundle; relative base ./
capacitor.config.json -> ios/App/       bundled dist, no remote server or navigation list
```

Keep dependencies injectable at module boundaries so unit tests do not require native plugins. Do not create a framework, remote service, custom Swift networking bridge or general-purpose proxy.

### Fixed contracts

- `SOURCES = Object.freeze({r34: ..., gel: ...})`; reject unknown source at startup/deep link, history/popstate, network, persistence and backup layers.
- Normalized post: `{...approvedFields, id: String(raw.id), source: 'r34'|'gel', key: source + ':' + id, file_url, preview_url, sample_url, tags}`. Keep upstream `id` for source URLs; `key` is the store/DOM identity. Never derive source from whichever tab happens to be open. Vault shows the selected source's favorites; identical numeric IDs from different sources cannot collide.
- `buildPostsUrl(source,{query='',sort='new',page=0,limit=20},credentials)` uses URL/URLSearchParams. `pid` is zero-based; tags are joined by spaces then encoded once, not raw string concatenation. Preserve Rule34 default `all`, `sort:score:desc`; Gelbooru `sort:score`; both oldest `sort:id:asc`. Keep Up uses limit 15/page 0; Reels limit 30 and video tag, bounded scans.
- `parsePosts(source,data)` accepts Rule34 array and Gelbooru array or `{post:[...], '@attributes':{count}}`/count envelope. Valid empty arrays/envelopes are success. Malformed JSON, HTML/challenge pages, auth/error objects and non-post shapes throw typed errors; never convert them to `[]`. Gelbooru envelope with explicit zero count and absent `post` can normalize to empty; unknown absent-post envelopes cannot.
- API origins restricted to `https://api.rule34.xxx` and `https://gelbooru.com`, known paths/actions only. Credentials attached only by builders to their own source endpoints. Autocomplete: Rule34 `/autocomplete.php?q=...`; Gelbooru `page=autocomplete2&term=...&type=tag_query&limit=25`. Rule34 count is XML DAPI posts with `limit=0&pid=0`; categories are Rule34 XML tag DAPI or Gelbooru autocomplete category. Parse XML with DOMParser and detect parsererror; optional metadata failure cannot erase loaded posts. Bound category concurrency to four, cancel/ignore old viewer token, cache per source.
- `request(url,{format:'json'|'text',signal})`: explicit `CapacitorHttp.request` for native, ordinary fetch only for browser preview. Keep global Capacitor HTTP fetch patching disabled. Native uses 15s connect/read options, a bounded overall deadline, status checks, redirects disabled for API calls, and sanitized errors. An AbortSignal does not magically cancel an in-flight native request: settle caller promptly, dispose timers/listeners and ignore late results via generation tokens. Never log credential-bearing URLs/native error bodies. No retry storm or cache of credentials/errors; initially omit transport cache.
- Distinguish auth (401/403 or recognized auth body), throttling (429), timeout, connectivity, blocked/challenge, invalid format and true zero results. Show Retry and Settings where applicable. Preserve previous good results and page position on pagination error; advance page only on success. Invalidate generations on source switch, back navigation, query change and returning to gateway, including secondary requests.
- Media stays direct in img/video tags; native API requests do not fix media playback automatically. Normalize protocol-relative URLs to HTTPS; reject non-HTTPS, userinfo, loopback/private IPs, unexpected ports and unsafe schemes. Restrict API-returned media to boundary-matched Rule34/Gelbooru domain families initially; source CDN additions require evidence from credential-free native verification, not arbitrary wildcard hosts. No proxy or API credentials appended to media URLs. Select actual MIME/type or omit instead of original hard-coded video/mp4. Unsupported codec/hotlink errors offer source link externally and do not spin forever.
- Storage: `NexusIOS`, version 1; IDB stores `likes` and `hearts` keyed by `key`, `tag_stats` keyed by `tag`, `preferences` keyed by `key`. Store UI preferences, tag lists, seen keys and history in preferences, with limits inherited from existing logic where present. Hydrate app memory once at startup, then async setters await writes and report failures. This small change avoids fragile cross-localStorage/IDB backup transactions. Keep shared tag lists/weights as original; source-qualify post identity and history entries. No media blobs or desktop DB enumeration.
- Per-source credentials are user-entered only, default blank; save and clear supported for both. Store separately from exportable preferences (reserved credential records excluded by explicit allowlist). Treat local IDB as app-local, **not encrypted/keychain**; tell user in build docs. No secrets in logs, fixtures, backup, bundle, URLs exposed to external browser or analytics. A stronger keychain solution is out of scope unless separately required.
- Versioned backup: `{format:'nexus-ios',version:1,settings,blacklist,favorites,tracked,savedTags,searchHistory,seenIds,likes,hearts,stats}`. `favorites` means favorite tags; `likes` holds saved posts and `hearts` reactions, matching old naming. Explicit settings allowlist excludes credentials. Validate entire input before any mutation: shape/version, supported source, string/numeric bounds, safe URLs, finite scores, unique keys; reject unknown fields/stores/prototype keys, >10 MiB, >10000 post records, overlong strings. Import replaces included supported snapshot data in one IDB transaction; failure/abort preserves old data. Cancel and malformed input make no changes. Do not silently accept unversioned desktop backups with source-less IDs: show an unsupported/ambiguous-backup error rather than guess a source. No automatic migration promised.
- External links use Browser.open after validation, never `allowNavigation` to source sites. Remove inline handlers and global `app`; bind events explicitly. CSP: bundled script only, no eval/remote JS, `object-src 'none'`, `frame-src 'none'`, `base-uri 'none'`, constrained connect/img/media origins. Inline style may remain because existing markup depends on it; do not allow inline scripts. Escape or DOM-create all untrusted tags/text/attributes to protect the native bridge from stored/reflected injection.
- Native downloads: FileTransfer writes validated media directly to a unique app-cache path, then Share shares the file URI; do not bridge large base64 files through JS. JSON export uses Filesystem UTF8 to cache then Share. Handle user cancellation, disk/network failure, concurrency (one active download) and clean stale cache at next startup with a short TTL, not before share consumers finish. JSON import uses existing single file input/iOS Files picker. Sharing a link is a separately labelled fallback, not a reported successful file download.

## Delegatable tasks

Each task below is the complete worker brief. Execute its small numbered actions in order (write test → observe failure → implement → pass → review/commit). Workers must not edit desktop files or implement beyond their assigned paths. Shared `src/app.js`/HTML edits are sequential; pure-module tasks can be parallel only after source contracts are frozen. Commit explicit paths, never `git add .` or raw desktop copies.

### Task 1: Scaffold the isolated build and security characterization

**Objective:** Establish runnable tests and a safe initial import, without shipping raw credentials.

**Files:** Create `.gitignore`, `package.json`, `package-lock.json`, `vite.config.js`, `src/main.js`, `tests/packaging.test.js`, `scripts/audit-package.mjs`; create sanitized `index.html`, `src/app.js`, `src/styles.css` from the three source files.

1. Add Node tests for exactly two gateway modes, no external executable assets, no excluded source identifiers/endpoints in shipped code and no nonempty literal source credentials. The initial missing-file checks must fail explicitly rather than skip. Add a dependency/asset test proving every local reference resolves.
2. Set scripts: `test: node --test tests/*.test.js`, `build: vite build`, `dev: vite --host 127.0.0.1`, `check: node scripts/audit-package.mjs`, `test:e2e: playwright test`; use ESM, Vite base `./`, dist output and no source maps in distributable. Add compatible Capacitor/plugin dependencies, fake-indexeddb and Playwright dev tooling; pin and lock.
3. Import only three audited text files, blank both IDs and keys in memory before writing. Remove old loader/CDN JSZip immediately, import CSS in main, export controller without auto-start/global; initialize once through main. Do not collect real source content into fixtures.
4. Run `node --test tests/packaging.test.js`: scope checks should still fail on copied excluded logic, establishing RED for Task 2. `npm run build` should bundle the module skeleton. Report these expected failures, do not label the suite green.
5. Inspect staged diff for credentials; commit only this sanitized scaffold with explicit paths, message `chore: scaffold isolated Nexus iOS build`.

### Task 2: Remove excluded features, preserving the booru interface

**Objective:** Apply the exact HTML/JS/CSS boundaries above instead of merely hiding unsupported features.

**Files:** Modify `index.html`, `src/app.js`, `src/styles.css`; extend `tests/packaging.test.js`.

1. Add assertions that excluded DOM nodes, stores, method names, extension targets and proxy domains are absent; assert retained Keep Up, Reels, tags, settings and media-viewer nodes remain.
2. Run `node --test tests/packaging.test.js` and observe excluded-feature failures.
3. Delete only the mapped features, preserving category helpers embedded within AI code. Clean startup/events/history branches, config identifiers and all calls to deleted methods. Remove the history telemetry POST. Leave extracted boundary calls explicit for subsequent tasks; never replace excluded methods with silent no-op stubs.
4. Run `node --check src/app.js`, `node --test tests/packaging.test.js`, `npm run build`; inspect retained DOM listeners for missing element assumptions. Commit `refactor: isolate Rule34 and Gelbooru UI`.

### Task 3: Implement source identity and request builders

**Objective:** Centralize supported source selection and correctly encoded requests.

**Files:** Create `src/sources.js`, `tests/sources.test.js`; modify `src/app.js` config references.

1. Test unknown modes (`f95`, `lewd`, `local`, `__proto__`, empty), page zero, each sort, tags containing `&`, `+`, `#`, Unicode, credentials with reserved characters, missing credential halves, source-link formation, and equal numeric IDs on different sources.
2. Run `node --test tests/sources.test.js` and observe missing exports.
3. Export source guard, `postKey`, builders for posts/autocomplete/count/categories/source links, URL validation and post normalization per contracts. Example key test: `assert.notEqual(postKey('r34','42'), postKey('gel','42'));`. Credentials are optional only as a complete pair; settings rejects partial pairs.
4. Run the same test plus `npm test`; commit `feat: add source-safe booru request builders`.

### Task 4: Parse API response formats without swallowing failures

**Objective:** Distinguish real empty results from bad source responses.

**Files:** Modify `src/sources.js`; create `tests/parsers.test.js`, `tests/fixtures/r34-posts.json`, `tests/fixtures/gel-posts.json`, `tests/fixtures/r34-count.xml`, `tests/fixtures/r34-tags.xml`.

1. Create small invented benign metadata fixtures with test URLs, never real accounts/content. Test arrays, serialized JSON, Gelbooru count envelope, explicit zero count, malformed text/HTML/auth objects, missing fields and unsafe media URLs. Exercise count/category XML in browser test if DOMParser is unavailable under Node; do not introduce an XML parser merely for tests.
2. Run `node --test tests/parsers.test.js` and observe missing parser behavior.
3. Implement parsers and normalized `source`, `key`, URLs, IDs/tags; preserve supported post fields actually rendered. Reject bad whole responses; handle missing individual media with an unavailable-media state rather than injected URL.
4. Run parser/source tests; commit `feat: validate booru response formats`.

### Task 5: Add explicit native networking and error contracts

**Objective:** Eliminate all proxy/PC traffic and handle status, timeouts and stale native results.

**Files:** Create `src/network.js`, `src/platform.js`, `tests/network.test.js`.

1. Inject fake native and browser transports; test native selection, no browser fallback on native failure, JSON/text response handling, 401/403/429/500, HTML with 200, connect/read options, denied URL/redirect, caller abort before/after dispatch, deadline, late resolution and timer cleanup. Assert sanitized messages omit test credential strings.
2. Run `node --test tests/network.test.js` and observe missing adapter failure.
3. Implement checked request contract with native helpers imported from `@capacitor/core`; browser fetch remains development preview, not a CORS workaround. Do not enable global fetch patching. Ensure URLSearchParams output is not double encoded by native options; pin/test the chosen API behavior.
4. Run network tests, `npm test`, `npm run build`; commit `feat: add native API transport without proxies`.

### Task 6: Replace extension storage with private transactional persistence

**Objective:** Persist supported user data without source collisions or false-success writes.

**Files:** Create `src/storage.js`, `tests/storage.test.js`; modify `src/app.js` DB initialization, all DB calls and preference loaders/setters.

1. Use fake-indexeddb to test retained stores only, reload persistence, blocked/open errors, write abort, independent `r34:42`/`gel:42`, source-filtered vault and bounded history/seen data. Test no desktop DB enumeration/message probes and that failed writes do not toggle UI to success.
2. Run `node --test tests/storage.test.js` and observe failure.
3. Implement schema and transaction-completion promises; hydrate retained settings/tags/history into controller once. Replace numeric/string double lookups with key lookups, remove localStorage mirroring, retain source-qualified post references and valid store allowlists. Startup failure shows Retry rather than partially initializing.
4. Run storage tests and build; commit `feat: persist private source-qualified Nexus data`.

### Task 7: Add both source credential settings

**Objective:** Let the owner configure, clear and validate their own accounts without bundled defaults.

**Files:** Modify `index.html`, `src/app.js`, `src/storage.js`; create `tests/credentials.test.js`.

1. Test blank initial credentials, independent source save/load, partial-pair validation, clearing both fields, and exclusion from exportable state. Test gateway access to settings in e2e later.
2. Run `node --test tests/credentials.test.js` and observe missing save/clear behavior.
3. Add `#r34-settings-group`, `#r34-uid-input`, `#r34-key-input`, `#save-r34-creds-btn`, clear controls for both sources; mask API-key inputs, disable autocorrection/capitalization. Rebind save handlers once (old loadSettings binding could repeat), allow deliberate empty-pair clearing, invalidate pending requests on account change. Surface account setup errors directly.
4. Run credential/storage tests and build; commit `feat: add private per-source account settings`.

### Task 8: Wire all retained views to the new source/transport boundaries

**Objective:** Keep Nexus behavior while preventing stale requests and false empty searches.

**Files:** Modify `src/app.js`; create `tests/search-flow.test.js`.

1. Test first-page pid=0, next-page success/error/retry, valid empty response, blacklist-only page, latest-query-wins, source switch during request, back/popstate with invalid source/view, stale autocomplete and category responses. Include Home, Keep Up and Reels, not just Explore.
2. Run `node --test tests/search-flow.test.js` with injected source calls; observe old/wrong behavior.
3. Route fetchData, Keep Up, Reels, autocomplete, XML count/category calls through modules. Delete both smartFetch implementations and duplicate parsers/builders. Preserve bounded filtered-page scan and local tag fallback; remove repeated empty-response retry and automatic query-erasing failure fallback. Commit page/currentPosts only for active successful generation; show contextual Retry/Settings without deleting favorites or old grid.
4. Run flow tests plus `npm test` and build; commit `feat: connect retained views to native-safe sources`.

### Task 9: Make DOM rendering and external navigation bridge-safe

**Objective:** Prevent remote/imported text and links from executing in the native app origin.

**Files:** Create `src/navigation.js`, `tests/navigation.test.js`; modify `src/app.js`, `index.html`.

1. Test javascript/data/file/custom-scheme links, userinfo, misleading domain suffixes, private IPs, unsafe media attributes, source-specific viewer links and input like `<img src=x onerror=...>` in tags/backup text. Add packaging test for no inline script/event handlers.
2. Run `node --test tests/navigation.test.js` plus packaging test and observe failures.
3. DOM-create dynamic cards/tags/history/FYP/suggestions/reels controls or escape context correctly; remove all template `onclick`/`onerror` and bind listeners. Use Browser.open for validated source/media external links; don't let target=_blank create a bridge-enabled remote window. Add restrictive CSP as contracted; never `unsafe-eval` or `unsafe-inline` scripts. Use post.source, not current mode, for links and categorization.
4. Run tests and build; real WebKit navigation/injection assertions follow in Task 13. Commit `fix: harden rendered content and external links`.

### Task 10: Implement validated atomic backup/restore

**Objective:** Restore the existing data controls as working, safe mobile features.

**Files:** Create `src/backup.js`, `tests/backup.test.js`; modify `src/storage.js`, `src/app.js` backupData/restoreData.

1. Test roundtrip of every retained field, settings allowlist, credential exclusion, unsupported source/store/version, unversioned desktop data, excessive size, malformed/prototype fields, duplicate keys, unsafe URLs, transaction failure and cancellation leaving data unchanged.
2. Run `node --test tests/backup.test.js` and observe missing validator/importer.
3. Implement contract and validate the full input before opening write transaction; replace included data atomically, hydrate only after successful commit. Export a coherent snapshot. Input accepts JSON only, clears file input after attempt and reports actionable errors without unconditional location.reload(). Wire export to file service in Task 11.
4. Run backup/storage tests; commit `feat: add validated transactional mobile backup`.

### Task 11: Add native file sharing and truthful media states

**Objective:** Export JSON and supported media through iOS Files/share interfaces without large JS blobs.

**Files:** Create `src/files.js`, `tests/files.test.js`; modify `src/app.js`, `index.html` viewer actions.

1. Mock plugins to test UTF8 JSON write→URI→share ordering, native download→share ordering, one-download guard, filename/path validation, share cancellation, download error, stale cache cleanup, and no success when only opening a URL. Test video MIME selection and media-load failure UI.
2. Run `node --test tests/files.test.js` and observe missing service.
3. Use Filesystem Cache + FileTransfer + Share. Add a clearly labelled viewer Save/Share file action. Keep existing poster/sample fallback without public proxies; remove forced MP4 type for other formats, use playsinline, honor mute/autoplay and gracefully handle rejected play promises. Pause/dispose old video and Reels observers on closing/switching views.
4. Run file tests/build; commit `feat: support native file export and media errors`. Mark all plugin behavior mocked until Mac gate, not iPhone-proven.

### Task 12: Adapt the existing layout for iPhone safe areas

**Objective:** Make the retained interface touch-usable without redesigning Nexus.

**Files:** Modify `src/styles.css`, `index.html`; create `tests/e2e/layout.spec.js` (runner in Task 13).

1. Write assertions for gateway, grid, settings and viewer at 390×844 and 320×568; no horizontal document overflow, no clipped close buttons, important actions minimum 44 CSS px, settings body independently scrollable.
2. Run the named layout test once runner exists; it must expose old fixed-height/grid issues before changes. If working before Task 13, install/configure only that runner part first and document dependency, not a skipped RED.
3. Set viewport-fit=cover, use 100dvh with fallback, top/bottom safe-area handling without double padding, `minmax(0,1fr)`/bounded grid columns, wrapping or scrollable tabs and full-screen bounded dialogs on narrow widths. Preserve tokens/icons/hierarchy and grid-size preference effect. Avoid untested keyboard-specific native plugin work unless WebKit/device test requires it.
4. Run layout test and inspect screenshots manually; commit `fix: fit Nexus layout to iPhone safe areas`.

### Task 13: Add deterministic mobile smoke and package gates

**Objective:** Prove retained flows and security constraints without using private credentials/live content.

**Files:** Create `playwright.config.js`, `tests/e2e/app.spec.js`, `tests/e2e/security.spec.js`, `tests/e2e/fixtures.js`; modify layout tests and `scripts/audit-package.mjs`.

1. Configure Chromium and WebKit projects, Vite test server bound to 127.0.0.1, fully stubbed source endpoints with benign SVG/image/video fixtures. No exported testing API/global in production bundle. Browser localhost is the development harness only; packaged app must not call a localhost backend.
2. Run `npx playwright install chromium webkit`; if host libraries are missing report dependency gate rather than claim passes. Run `npm run test:e2e` to identify failures before fixing them in relevant tasks.
3. Cover gateway only two modes, direct invalid ?m= input, settings reachable without network, credentials save/clear/reload, search/autocomplete/sort/pagination, Home, Keep Up, Reels, source-specific Vault and duplicate IDs, blacklist, viewer next/previous and links, history, theme/grid settings reload, backup import/export, offline/auth/429/malformed-data states and Retry. Assert no pageerror, inline-code execution, remote script, unsupported endpoint or credential leakage. Optional XML metadata tests run in WebKit.
4. Audit both source and dist for excluded app features, server URLs, proxy domains, embedded credential literals and unbundled asset references. Exclude docs/tests/node_modules from literal forbidden-word scans; inspect generated Capacitor internals separately so its local bundled origin is not misreported as a backend dependency. A negative scanner test must demonstrate it catches a synthetic leaked-key literal and prohibited endpoint, not only approve the actual files.
5. Run `npm test && npm run build && npm run check && npm run test:e2e`. Record exact passes/failures/browser versions and screenshots under ignored `test-results/`. Commit `test: verify retained mobile flows and package boundaries` only with honest gate status.

### Task 14: Create the iOS shell and document the Mac verification gate

**Objective:** Deliver reproducible source/native project preparation, not an invented signed IPA.

**Files:** Create `capacitor.config.json`, `README.md`, `docs/ios-build.md`, `docs/verification.md`; generated `ios/App/` and required native project files when CLI allows; modify `.gitignore`, packaging tests.

1. Test config has appName Nexus, provisional appId `com.nexus.personal`, `webDir:'dist'`, no `server.url`, no remote `allowNavigation`, native HTTP patching disabled. Test no broad ATS exceptions, private account files, signing identities or unsafe remote content configuration. Identifier is local project metadata, not a registered Apple identifier; authorized Mac operator may change it before signing.
2. Run config tests RED, implement configuration, run `npm run build`, `npx cap add ios`, `npx cap sync ios`. Do not hand-invent a native project if CLI cannot create/sync on WSL. Report exact limitation and leave the reproducible generation step for Mac. Verify generated native files only if commands actually succeeded.
3. On Mac, operator runs `npm ci`, `npm run build`, `npx cap add ios` only if ios is absent, `npx cap sync ios`, `npx cap open ios`; select installed Xcode-supported simulator and build without personal signing first. Resolve actual generated workspace/project and scheme using Xcode/`xcodebuild -list`, not guessed scheme names. Include required Filesystem privacy manifest reason declarations from the installed plugin documentation; keep ATS default secure. Check deployment target, generated assets, rotation/keyboard behavior and external WKWebView navigation policy.
4. Device matrix: API auth entered manually for each source, native success/401/429/offline/timeout, source switch during pending requests, image/GIF/supported video plus unsupported codec, download/share to Files, cancelled share/import, cache cleanup, safe areas/keyboard/rotation, persistence after app restart, source links isolated from Capacitor bridge. No source content screenshots or credentials in committed evidence. Clarify metadata remains offline, new content/media needs internet and app deletion can remove local data.
5. Signing/sideload instructions only: use an authorized Mac and operator-controlled account/provisioning, review bundle identifier, then archive/install according to their available authorized route. Never purchase services or use credentials automatically. Document signing/provisioning expiry as dependent on method rather than promise permanence.
6. Final verification on WSL: `git diff --check`, all available automated gates, staged credential audit and `git status --short`. Write docs/verification.md with separate status for source checks, browser tests, native project generation, simulator, device, signing and installation. Commit explicit files as `docs: add iOS shell setup and native verification gates`; no push.

## Delegation order and ownership

1 → 2 establishes safe copy. 3 → 4 owns sources. 5 owns transport; 6 owns storage. Pure modules 3–5 and storage module work can be independent after contracts, but serialize their app.js integration. 7 needs 6; 8 needs 3–7. 9 then 10 then 11 integrate security/data/files. Set up Task 13 runner before Task 12 RED; finish Task 13 after 12. Task 14 config can start after scaffold, final documentation waits for real gate results. Do not let multiple workers rewrite app.js concurrently.

Each worker returns changed paths, commands with actual outcomes, remaining risks, and commit ID if committed. No additional user approval gate is needed for scoped implementation; Mac/signing access remains a real prerequisite, not a design question.

## Risks and explicit nonclaims

- Native API HTTP bypasses browser CORS; it does not bypass authentication, throttling, source blocks, media hotlink policies or codec limits.
- Existing HTML interpolation plus native bridge is a serious trust boundary; CSP and safe DOM changes are mandatory, not polish.
- Existing numeric ID persistence collides across sources; original favorites lack source provenance, so automatic desktop import is intentionally rejected.
- Existing export is a dangling method reference; preserving the button alone is insufficient.
- API keys were embedded in source; never copy them, and recommend owner rotation without exposing values.
- Official HTTP/FileTransfer options and iOS toolchain compatibility must be verified against locked packages. Relevant documentation consulted: https://capacitorjs.com/docs/apis/http, https://capacitorjs.com/docs/apis/file-transfer, https://capacitorjs.com/docs/apis/share. Explicit HTTP helpers, native file downloads to URI and Share files are documented; actual iOS runtime behavior remains untested here.
- Browser preview may hit CORS if used live; tests use deterministic mocks and no development proxy is bundled. Do not describe browser mocks as native connectivity proof.
- No keychain encryption is promised; local account storage is isolated app data, not an encrypted vault.
- App source can be delivered in WSL; an installed, signed and verified iPhone app cannot be claimed until the Mac/device gate has actually passed.
