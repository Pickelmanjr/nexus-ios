"""Build the iOS stylesheet from the desktop one.

Rules are removed only when *every* selector in the rule belongs to a removed
feature. A rule whose selector list mixes removed and retained selectors keeps
its retained selectors, so shared declarations survive.
"""
import re
import sys
from pathlib import Path

SRC = Path("C:/nexus/styles.css")
DST = Path("C:/nexus-ios/src/styles.css")

# A selector is dropped when it mentions any of these.
DROP_SELECTOR = re.compile(
    r"("
    r"\.f95[\w-]*|#f95[\w-]*|"
    r"body\.f95-active|\.gw-card\.f95|\.gw-card\.local|"
    r"\.local-[\w-]*|#local-[\w-]*|\.delete-local-btn|\.local[A-Z][\w-]*|"
    r"\.dropzone|\.zip-[\w-]*|"
    r"\.game-[\w-]*|#game-[\w-]*|\.game[\w-]*-overlay|"
    r"\.ai-[\w-]*|#ai-[\w-]*|\.viewer-ai-corner|"
    r"\.sidebar-toggle|\.tag-picker-input|\.mobile-only"
    r")"
)


def split_top_level(css):
    """Yield (kind, text) chunks: at-rule blocks are kept whole for recursion."""
    out = []
    i = 0
    n = len(css)
    while i < n:
        brace = css.find("{", i)
        if brace == -1:
            out.append(("raw", css[i:]))
            break
        prelude = css[i:brace]
        depth = 1
        j = brace + 1
        while j < n and depth:
            if css[j] == "{":
                depth += 1
            elif css[j] == "}":
                depth -= 1
            j += 1
        block = css[brace + 1:j - 1]
        stripped = prelude.strip()
        kind = "at" if stripped.startswith("@") and "{" in css[brace:j] and re.match(r"@(media|supports|layer|container)\b", stripped) else "rule"
        out.append((kind, prelude, block))
        i = j
    return out


def filter_css(css):
    pieces = []
    for chunk in split_top_level(css):
        if chunk[0] == "raw":
            pieces.append(chunk[1])
            continue
        _, prelude, block = chunk
        stripped = prelude.strip()

        if stripped.startswith("@") and re.match(r"@(media|supports|layer|container)\b", stripped):
            inner = filter_css(block)
            if inner.strip():
                pieces.append("%s{%s}" % (prelude, inner))
            continue

        if stripped.startswith("@"):
            pieces.append("%s{%s}" % (prelude, block))
            continue

        # Split the selector list and keep only the retained selectors.
        leading = prelude[:len(prelude) - len(prelude.lstrip())]
        selectors = [s.strip() for s in stripped.split(",")]
        kept = [s for s in selectors if s and not DROP_SELECTOR.search(s)]
        if not kept:
            continue
        pieces.append("%s%s{%s}" % (leading, ", ".join(kept), block))
    return "".join(pieces)


MOBILE_ADDITIONS = """

/* ---------------------------------------------------------------
   iPhone fit-up and the few controls this build adds.
   Everything above is the desktop Nexus stylesheet with the removed
   features' selectors stripped out.
   --------------------------------------------------------------- */

:root {
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --tap-target: 44px;
}

/* 100vh is wrong on iOS while the browser chrome moves; dvh tracks it. */
html, body { height: 100%; }
body { min-height: 100vh; min-height: 100dvh; overflow-x: hidden; }

.app-layout, .main-content { min-height: 100vh; min-height: 100dvh; }

/* The top bar and tab bar are the only elements that pay the safe area, so
   the padding is never applied twice down the tree. */
.top-bar { padding-top: calc(0.75rem + var(--safe-top)); }
.gateway-screen { padding-top: var(--safe-top); padding-bottom: var(--safe-bottom); }
.tab-bar, .bottom-tabs, nav[role="menubar"] {
  padding-bottom: calc(0.5rem + var(--safe-bottom));
}

/* The filter sidebar is gone, so the explore row now has exactly one child.
   Left as a flex row that turns into a column on narrow screens, the wrapper
   took its width from its content and collapsed to a couple of pixels. */
.explore-layout { display: block; height: 100%; }
.grid-content-wrapper { width: 100%; min-width: 0; }

.media-grid {
  grid-template-columns: repeat(auto-fill, minmax(min(var(--grid-size, 280px), 100%), 1fr));
}

/* On a phone the desktop track sizes all collapse to a single column, which
   would leave the grid-size preference with nothing to do. Scaling them keeps
   small/medium/large meaningfully different at 390px: three, two and one
   column respectively. */
@media (max-width: 640px) {
  .media-grid {
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fill, minmax(min(calc(var(--grid-size, 280px) * 0.43), 100%), 1fr));
  }
}

/* Tables, chip rows and tag rows must scroll inside themselves rather than
   pushing the document sideways. */
.chip-container, .prev-searches-list, .gateway-stats { flex-wrap: wrap; }
.ku-row { overflow-x: auto; -webkit-overflow-scrolling: touch; }

.settings-modal {
  max-width: min(680px, calc(100vw - 24px));
  max-height: calc(100dvh - var(--safe-top) - var(--safe-bottom) - 24px);
  margin: auto;
}
.settings-modal .settings-body,
.settings-modal > div:last-child { overflow-y: auto; -webkit-overflow-scrolling: touch; }

.lightbox { max-width: 100vw; max-height: 100dvh; }
.lightbox-close, .lightbox-nav, .action-btn, .icon-btn, .tab-item {
  min-width: var(--tap-target);
  min-height: var(--tap-target);
}
.lightbox-close {
  top: calc(8px + var(--safe-top));
  right: calc(8px + var(--safe-right));
}

@media (max-width: 640px) {
  .lightbox-content, .lightbox { flex-direction: column; }
  .lightbox-sidebar { max-height: 45dvh; overflow-y: auto; }
  .tab-bar, nav[role="menubar"] { flex-wrap: nowrap; overflow-x: auto; }
}

/* Controls this build adds. */
.startup-error {
  position: relative;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  padding: 20px;
  margin: 16px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.6);
  text-align: center;
}

.eor-action { margin-left: 10px; }

.row-spinner { display: flex; justify-content: center; width: 100%; padding: 2rem; }
.ku-row-msg { padding: 1.5rem; font-size: 0.9rem; color: var(--text-muted); font-style: italic; }
.ku-row-msg.is-error { color: var(--heart); font-style: normal; font-weight: 600; }
.ku-title { cursor: pointer; }
.ku-view-all {
  padding: 0.4rem 1rem;
  border-radius: 20px;
  font-size: 0.75rem;
  text-transform: uppercase;
  font-weight: 800;
}

.card-actions-br { top: auto; bottom: 20px; left: auto; right: 20px; }

.viewer-image { max-width: 100%; max-height: 100%; border-radius: 8px; }
#video-flex-container {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.viewer-spinner { position: absolute; z-index: 20; pointer-events: none; }
#viewer-poster {
  position: absolute;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  z-index: 10;
  border-radius: 8px;
  transition: opacity 0.4s;
  pointer-events: none;
}
#viewer-video {
  position: relative;
  z-index: 15;
  max-width: 100%;
  max-height: 100%;
  border-radius: 8px;
  opacity: 0;
  transition: opacity 0.4s;
}

.media-unavailable {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  justify-content: center;
  padding: 32px;
  text-align: center;
  color: var(--text);
}

.sugg-notice {
  padding: 0.5rem 0.75rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  font-style: italic;
}
.muted-note { color: var(--text-muted); font-size: 0.8rem; font-style: italic; }

.tag-action { margin-left: 8px; opacity: 0.45; cursor: pointer; }
.tag-action.active, .tag-action.saved { opacity: 1; }

.section-title.accent-r34 { color: #ff0055; }
.section-title.accent-gel { color: #0088ff; }

.settings-group .form-input { margin-bottom: 10px; }
.settings-actions { display: flex; gap: 10px; flex-wrap: wrap; }
"""


def main():
    css = SRC.read_text(encoding="utf-8")
    before = len(css)
    # Strip comments first: most of them narrate removed features, and a
    # comment sitting in a rule's prelude would otherwise survive its rule.
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    filtered = filter_css(css)
    filtered = re.sub(r"\n{3,}", "\n\n", filtered)

    leftovers = [name for name in ("f95", "ai-chat", "game-viewer", "dropzone", "local-media")
                 if name in filtered.lower()]
    if leftovers:
        sys.exit("excluded selectors survived: " + ", ".join(leftovers))

    out = filtered.rstrip() + "\n" + MOBILE_ADDITIONS
    DST.write_text(out, encoding="utf-8")
    print("styles.css: %d -> %d bytes (%d lines)" % (before, len(out), out.count("\n") + 1))


if __name__ == "__main__":
    main()
