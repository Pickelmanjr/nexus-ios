# Nexus iPhone app design

## Approved direction

Create a separate sideloadable iPhone application containing only Rule34 and Gelbooru, preserving Nexus's existing layout and applicable settings. It must not require the user's PC to be running. Source website: C:\nexus. New project: C:\nexus-ios. Do not edit the desktop website.

## Architecture

Bundle an audited copy of index.html, app.js, styles.css and their required local assets in an iOS web-view shell. Use Capacitor for the shell and native HTTP for supported API requests that cannot run inside the web view due to cross-origin restrictions. The app stores favorites, tags, history and settings locally. Internet access is required to retrieve new source content. No server, browser extension, Python runtime or Ollama is required on the phone.

Restrict gateway options and supported database identifiers to Rule34 and Gelbooru. Remove F95, AI, local ZIP/media import and desktop bridge controls from the mobile copy, including unreachable code and requests to localhost. Preserve search, tags, favorites, blacklist, grid preferences, themes, viewer and applicable backup/restore behavior. Adapt downloads/export to supported iOS file/share interfaces rather than promising desktop browser behavior.

## Interface

Reuse the original website's colors, typography, icons and visual hierarchy, not a new design system. Respect iPhone safe areas, touch targets, portrait viewport and keyboard resizing. Keep the gateway, grid, viewer and settings recognizable. Native changes should be functional, not decorative.

## Data and networking

Trace each source's existing API request and media URL handling before replacing transport. Use a small shared networking adapter with explicit timeouts, status validation and readable errors. Do not ship public CORS proxy fallbacks. Source credentials belong in per-source settings; do not copy embedded credentials, saved cookies or desktop account data into the project. Do not upload the project or private source data to any external service without authorization.

Source authentication, rate limits and unavailable media must yield actionable error messages without losing current settings or favorites. A failed request must not be shown as an empty successful search. External web links must not gain access to native app capabilities. Keep navigation restricted to bundled content and explicitly handled external links.

## Excluded

AI chat, model downloads, F95 browsing/scraping, desktop media libraries, browser extension installation and PC connection settings. No automatic synchronization of desktop browser storage. Backup import must validate input and supported source names before applying it.

## Verification

Before modifying copied logic, create tests for the two-source allowlist, absence of localhost dependencies and credential-free packaging. Verify search request formation, both supported API response formats, transport failures and persistence. Run syntax checks and mobile browser smoke tests for gateway, settings, search, grid and viewer. Check safe areas and portrait overflow.

An iOS simulator/device build is a separate verification gate requiring macOS/Xcode. Native networking, media playback, downloads, signing and actual sideload installation must be tested there; passing browser tests is not proof they work on iPhone. Until that environment is available, report the deliverable as source/project files, not a signed or tested IPA.

## Delivery

Provide the isolated source project and build/signing instructions. Do not purchase signing services, use the user's Apple account or publish a repository automatically. Determine the user's available Mac or authorized macOS build option before attempting an iOS binary build.
