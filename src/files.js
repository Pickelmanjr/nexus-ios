import { safeMediaUrl } from './sources.js';

// Saving on iOS means: write into the app's own cache directory, then hand the
// resulting file URI to the share sheet. Large media never crosses the JS
// bridge as base64 -- FileTransfer writes it natively.

const CACHE_DIRECTORY = 'CACHE';
const EXPORT_FOLDER = 'nexus-exports';
const STALE_MS = 24 * 60 * 60 * 1000;

let plugins = null;
let activeDownload = null;

export function setFilePlugins(next) {
  plugins = next;
}

export class FileError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'FileError';
    this.kind = kind;
  }
}

async function loadPlugins() {
  if (plugins) return plugins;
  const [{ Filesystem, Directory }, { FileTransfer }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/file-transfer'),
    import('@capacitor/share')
  ]);
  plugins = { Filesystem, Directory, FileTransfer, Share };
  return plugins;
}

function safeFilename(name, fallbackExt) {
  // Separators become dashes and dot runs collapse, so nothing that looks like
  // a traversal survives into the path even as a literal filename.
  const cleaned = String(name || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+/, '')
    .slice(0, 80);
  if (!cleaned) return 'nexus-' + Date.now() + fallbackExt;
  return cleaned;
}

function directoryFor(api) {
  return (api.Directory && api.Directory.Cache) || CACHE_DIRECTORY;
}

/** Write a UTF-8 JSON file into the cache, then offer it to the share sheet. */
export async function saveJsonFile(filename, text) {
  const api = await loadPlugins();
  const path = EXPORT_FOLDER + '/' + safeFilename(filename, '.json');
  const directory = directoryFor(api);

  await api.Filesystem.mkdir({ path: EXPORT_FOLDER, directory, recursive: true }).catch(() => {});
  await api.Filesystem.writeFile({ path, directory, data: text, encoding: 'utf8' });
  const { uri } = await api.Filesystem.getUri({ path, directory });

  try {
    await api.Share.share({ title: 'Nexus backup', files: [uri] });
  } catch (e) {
    // A cancelled share sheet is a normal outcome, not a failed export.
    return { saved: true, shared: false, uri };
  }
  return { saved: true, shared: true, uri };
}

/**
 * Download one media file natively and share it. Only one download runs at a
 * time: a second tap while one is in flight is refused rather than queued, so
 * the cache cannot fill with half-written files.
 */
export async function saveMediaFile(url, filename) {
  const safeUrl = safeMediaUrl(url);
  if (!safeUrl) throw new FileError('denied', 'That media address is not allowed.');
  if (activeDownload) throw new FileError('busy', 'A download is already running.');

  // Claim the slot synchronously, before the first await: two taps in the same
  // tick would otherwise both get past the check above.
  activeDownload = safeUrl;
  try {
    const api = await loadPlugins();
    const extMatch = safeUrl.match(/\.([A-Za-z0-9]{2,4})(?:\?.*)?$/);
    const ext = extMatch ? '.' + extMatch[1].toLowerCase() : '.bin';
    const path = EXPORT_FOLDER + '/' + safeFilename(filename || ('nexus-' + Date.now() + ext), ext);
    const directory = directoryFor(api);

    await api.Filesystem.mkdir({ path: EXPORT_FOLDER, directory, recursive: true }).catch(() => {});
    const { uri } = await api.Filesystem.getUri({ path, directory });
    await api.FileTransfer.downloadFile({ url: safeUrl, path: uri, progress: false });

    try {
      await api.Share.share({ title: 'Save media', files: [uri] });
    } catch (e) {
      return { saved: true, shared: false, uri };
    }
    return { saved: true, shared: true, uri };
  } catch (error) {
    if (error instanceof FileError) throw error;
    throw new FileError('download', 'That file could not be downloaded.');
  } finally {
    activeDownload = null;
  }
}

/**
 * Drop export files left behind by earlier sessions. Run at startup only, so a
 * share sheet still holding a file from this session is never pulled away.
 */
export async function cleanStaleCache(now = Date.now()) {
  let api;
  try {
    api = await loadPlugins();
  } catch (e) {
    return 0;
  }
  const directory = directoryFor(api);
  let removed = 0;
  try {
    const listing = await api.Filesystem.readdir({ path: EXPORT_FOLDER, directory });
    for (const entry of listing.files || []) {
      const name = typeof entry === 'string' ? entry : entry.name;
      const mtime = typeof entry === 'string' ? 0 : Number(entry.mtime) || 0;
      if (mtime && now - mtime < STALE_MS) continue;
      await api.Filesystem.deleteFile({ path: EXPORT_FOLDER + '/' + name, directory }).catch(() => {});
      removed++;
    }
  } catch (e) {
    return removed;
  }
  return removed;
}
