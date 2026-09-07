"""One-shot extraction of the desktop Nexus controller into the iOS project.

Deletes the excluded feature blocks by method name (not by frozen line numbers)
and blanks the embedded Rule34/Gelbooru credentials before anything is written
to disk. Run once; subsequent edits happen on the extracted file.
"""
import re
import sys
from pathlib import Path

SRC = Path("C:/nexus/app.js")
DST = Path("C:/nexus-ios/src/app.js")

# Whole methods removed from the mobile build.
DROP_METHODS = [
    "autoRecoverOldVault",
    "handleDrop", "handleZipSelect", "_mimeForExt", "processZip",
    "updateLocalGroupFilters", "_saveLocalItem", "_deleteLocalItem_db",
    "_loadSavedLocalMedia", "clearAllLocal", "deleteLocalGroup", "deleteLocalItem",
    "shuffleLocal", "prevLocalPage", "nextLocalPage", "renderLocalGrid",
    "_updateLocalPagination",
    "addF95Tag", "bindF95TagInput", "bindF95TagPicker", "resetF95FiltersForHome",
    "applyF95TextSearch", "loadF95DefaultHome", "refreshF95Latest",
    "loadGameRecommendations", "bindF95SidebarEvents", "renderF95TagChips",
    "renderF95ExcTagChips", "populateF95Dropdowns", "executeF95Search",
    "smartFetch", "fetchLewdData", "fetchF95Data",
    "openGameViewer",
    "isAIChatMode", "updateAIChatVisibility", "bindAIChat", "updateAIChatContextPill",
    "appendAIChatMessage", "cleanAIReplyForDisplay", "_normalizeAITag",
    "_uniqueAITags", "extractAIKeywordTerms", "inferAITagsFromMessage",
    "resolveAIChosenTags", "parseAITagsFromReply", "fetchAITagAutocomplete",
    "collectAIAvailableTags", "renderAISearchSuggestions", "applyAISearch",
    "compactAIItem", "getOpenVideoAIContext", "buildAIChatContext",
    "openAIChatForVideo", "mountAIChatInVideo", "restoreAIChatToPage", "sendAIChat",
    "closeGameViewer", "toggleGameFavorite",
    "smartFetchText",
]

# State properties removed from the app object literal.
DROP_STATE = re.compile(
    r"^  (f95Data|f95ManualTags|f95AllTags|f95AllEngines|f95AllStatuses|"
    r"f95AllPrefixes|f95Filters|aiChatHistory|aiContextItem|aiChatBusy|"
    r"aiChatVideoHintShown|localMedia|localGroups|localFilters|localPage|"
    r"_pageTransition):"
)

METHOD_START = re.compile(r"^  (?:async )?([A-Za-z_$][\w$]*)\s*\(")


def method_spans(lines):
    """Map method name -> (start, end) as 0-based half-open line indices."""
    starts = []
    for i, line in enumerate(lines):
        m = METHOD_START.match(line)
        if m:
            starts.append((i, m.group(1)))
    spans = {}
    for idx, (start, name) in enumerate(starts):
        end = starts[idx + 1][0] if idx + 1 < len(starts) else len(lines)
        spans.setdefault(name, (start, end))
    return spans


def main():
    lines = SRC.read_text(encoding="utf-8").splitlines(keepends=True)

    # 1. Drop the DB object entirely: it is replaced by src/storage.js.
    app_start = next(i for i, l in enumerate(lines) if l.startswith("const app = {"))
    lines = lines[app_start:]

    # 2. Drop excluded methods.
    spans = method_spans(lines)
    missing = [n for n in DROP_METHODS if n not in spans]
    if missing:
        sys.exit("methods not found, refusing to guess: " + ", ".join(missing))
    kill = set()
    for name in DROP_METHODS:
        start, end = spans[name]
        kill.update(range(start, end))
    lines = [l for i, l in enumerate(lines) if i not in kill]

    # 3. Drop excluded state properties.
    lines = [l for l in lines if not DROP_STATE.match(l)]

    text = "".join(lines)

    # 4. Blank the embedded credentials. Values are never read into any output.
    text = re.sub(r'uid:\s*"[^"]*"', 'uid: ""', text)
    text = re.sub(r'key:\s*"[^"]*"', 'key: ""', text)

    # 5. Drop the lewd and f95 source configs (object literals inside `configs`).
    text = re.sub(r"\n    lewd: \{.*?\n    \},", "", text, flags=re.S)
    text = re.sub(r"\n    f95: \{.*?\n    \},?", "", text, flags=re.S)

    leaked = re.search(r'(uid|key):\s*"[^"]+"', text)
    if leaked:
        sys.exit("credential literal survived redaction: " + leaked.group(0))

    DST.write_text(text, encoding="utf-8")
    print("wrote %s (%d lines)" % (DST, text.count("\n") + 1))


if __name__ == "__main__":
    main()
