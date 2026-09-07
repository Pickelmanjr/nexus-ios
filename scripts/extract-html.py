"""Build the iOS index.html from the desktop one.

Removes the excluded features as whole balanced elements rather than by line
number, replaces the cache-busting script loader with the bundled module entry,
and expands the single Gelbooru API box into per-source account settings.
"""
import re
import sys
from pathlib import Path

SRC = Path("C:/nexus/index.html")
DST = Path("C:/nexus-ios/index.html")

NEW_HEAD = """<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="Nexus - Rule34 and Gelbooru browser">
  <meta name="referrer" content="no-referrer">
  <meta name="color-scheme" content="dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.rule34.xxx https://rule34.xxx https://*.gelbooru.com https://gelbooru.com; media-src 'self' blob: https://*.rule34.xxx https://rule34.xxx https://*.gelbooru.com https://gelbooru.com; connect-src 'self' https://api.rule34.xxx https://gelbooru.com; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
  <title>Nexus</title>
  <script type="module" src="/src/main.js"></script>
</head>"""


def cut_balanced(html, start_pattern, tag, label):
    """Remove one element, matching nested open/close tags of `tag`."""
    match = re.search(start_pattern, html)
    if not match:
        sys.exit("could not find %s" % label)
    start = match.start()
    pos = match.end()
    depth = 1
    token = re.compile(r"<(/?)%s\b" % tag, re.I)
    while depth > 0:
        found = token.search(html, pos)
        if not found:
            sys.exit("unbalanced %s while removing %s" % (tag, label))
        depth += -1 if found.group(1) else 1
        pos = found.end()
    end = html.index(">", pos) + 1
    return html[:start] + html[end:]


def cut_between(html, start_marker, end_marker, label):
    start = html.find(start_marker)
    if start == -1:
        sys.exit("could not find start of %s" % label)
    end = html.find(end_marker, start)
    if end == -1:
        sys.exit("could not find end of %s" % label)
    return html[:start] + html[end:]


ACCOUNT_SECTIONS = """      <section class="settings-section" id="r34-settings-group">
        <h3 class="section-title accent-r34">Rule34 account</h3>
        <div class="settings-group bento-group">
          <p class="row-subtext">Optional. Your <strong>User ID</strong> and <strong>API Key</strong> from your Rule34
            account. Stored only on this device, and never included in an export.</p>
          <input type="text" id="r34-uid-input" class="form-input" placeholder="User ID" autocomplete="off"
            autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="numeric" aria-label="Rule34 User ID">
          <input type="password" id="r34-key-input" class="form-input" placeholder="API Key" autocomplete="off"
            autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Rule34 API Key">
          <div class="settings-actions">
            <button type="button" class="btn btn-outline-info" id="save-r34-creds-btn">Save</button>
            <button type="button" class="btn btn-outline-warning" id="clear-r34-creds-btn">Clear</button>
          </div>
          <p class="row-subtext" id="r34-creds-status" role="status"></p>
        </div>
      </section>

      <section class="settings-section" id="gel-settings-group">
        <h3 class="section-title accent-gel">Gelbooru account</h3>
        <div class="settings-group bento-group">
          <p class="row-subtext">Optional. Your <strong>User ID</strong> and <strong>API Key</strong> from your Gelbooru
            account. Stored only on this device, and never included in an export.</p>
          <input type="text" id="gel-uid-input" class="form-input" placeholder="User ID" autocomplete="off"
            autocapitalize="off" autocorrect="off" spellcheck="false" inputmode="numeric" aria-label="Gelbooru User ID">
          <input type="password" id="gel-key-input" class="form-input" placeholder="API Key" autocomplete="off"
            autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Gelbooru API Key">
          <div class="settings-actions">
            <button type="button" class="btn btn-outline-info" id="save-gel-creds-btn">Save</button>
            <button type="button" class="btn btn-outline-warning" id="clear-gel-creds-btn">Clear</button>
          </div>
          <p class="row-subtext" id="gel-creds-status" role="status"></p>
        </div>
      </section>
"""

DATA_SECTION = """      <section class="settings-section">
        <h3 class="section-title">Data Management</h3>
        <div class="settings-actions">
          <button type="button" class="btn btn-outline-success" id="backup-btn">Export data</button>
          <button type="button" class="btn btn-outline-info" id="restore-btn">Import data</button>
          <input type="file" id="restore-file-input" accept="application/json,.json" hidden>
          <button type="button" class="btn btn-outline-warning" id="reset-algo-btn">Reset For You</button>
        </div>
        <p class="row-subtext" id="backup-status" role="status"></p>
        <p class="row-subtext">Exports go through the iOS share sheet. Accounts are never included in an export.</p>
      </section>
"""

VIEWER_ACTIONS = """            <button type="button" class="action-btn" id="viewer-save-btn" aria-label="Save this file">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </div>
          <p class="row-subtext" id="viewer-save-status" role="status"></p>
"""


def main():
    html = SRC.read_text(encoding="utf-8")

    # 1. Head: bundled module entry, no CDN, no cache-busting loader.
    html = re.sub(r"<head>.*?</head>", lambda m: NEW_HEAD, html, count=1, flags=re.S)

    # 2. Gateway keeps the two supported sources only.
    for mode in ("f95", "local"):
        html = cut_balanced(html, r'<button class="gw-card %s"' % mode, "button", "%s gateway card" % mode)

    # 3. Filter sidebar toggle and the F95 filter sidebar itself.
    html = cut_balanced(html, r'<button type="button" class="icon-btn sidebar-toggle"', "button", "sidebar toggle")
    html = cut_balanced(html, r'<aside id="f95-sidebar"', "aside", "F95 sidebar")

    # 4. Local archive view, game vault / local tabs, AI chat, game viewer.
    html = cut_balanced(html, r'<div class="view-container" id="local-zip-view"', "div", "local view")
    html = cut_balanced(html, r'<button type="button" class="tab-item nav-item" data-view="game_vault"', "button", "game vault tab")
    html = cut_balanced(html, r'<button type="button" class="tab-item nav-item" data-view="local"', "button", "local tab")
    html = cut_balanced(html, r'<div id="ai-chat-home">', "div", "AI chat")
    html = cut_balanced(html, r'<dialog id="game-viewer"', "dialog", "game viewer")

    # 5. Per-source account settings in place of the single Gelbooru box.
    html = cut_between(html, '      <section class="settings-section" id="gel-settings-group">',
                       '      <section class="settings-section">\n        <h3 class="section-title">Data Management</h3>',
                       "Gelbooru settings section")
    html = html.replace('      <section class="settings-section">\n        <h3 class="section-title">Data Management</h3>',
                        ACCOUNT_SECTIONS + "\n" + '      <section class="settings-section">\n        <h3 class="section-title">Data Management</h3>', 1)

    # 6. Rewrite the data-management block so export/import report their status.
    html = cut_between(html, '      <section class="settings-section">\n        <h3 class="section-title">Data Management</h3>',
                       "    </div>\n  </dialog>", "data management section")
    html = html.replace("    </div>\n  </dialog>", DATA_SECTION + "\n    </div>\n  </dialog>", 1)

    # 7. A save/share action in the viewer, next to favorite and like.
    html = html.replace("""            </button>
          </div>
        </div>
        <div class="stats-grid" id="viewer-stats"></div>""",
                        VIEWER_ACTIONS + """        </div>
        <div class="stats-grid" id="viewer-stats"></div>""", 1)

    # 8. The stylesheet is imported by the module entry, so drop the tag if the
    #    head rewrite left one behind.
    html = re.sub(r'\n\s*<link rel="stylesheet" href="styles\.css[^"]*">', "", html)

    # 9. The accent swatch named after a removed source keeps its color but not
    #    its name: it is only a theme choice.
    html = html.replace('aria-label="F95 Red"', 'aria-label="Red"')

    # Assert nothing excluded survives.

    leftovers = {
        "jszip": "jszip",
        "f95": "f95",
        "game-viewer": "game-viewer",
        "local-zip": "local-zip",
        "ai-chat": "ai-chat",
        "localhost": "localhost",
        "onclick": "onclick=",
        "onerror": "onerror=",
    }
    lowered = html.lower()
    found = [name for name, needle in leftovers.items() if needle in lowered]
    if found:
        sys.exit("excluded markup survived: " + ", ".join(found))

    # Element removal leaves behind lines of pure indentation.
    html = re.sub(r"[ \t]+$", "", html, flags=re.M)
    html = re.sub(r"\n{3,}", "\n\n", html)

    DST.write_text(html, encoding="utf-8")
    print("wrote %s (%d lines)" % (DST, html.count("\n") + 1))


if __name__ == "__main__":
    main()
