import { assertSource, splitKey } from './sources.js';

export const DB_NAME = 'NexusIOS';
export const DB_VERSION = 1;

// `likes` holds saved posts, `hearts` holds reactions -- the desktop naming is
// kept so an exported file reads the same way. Both are keyed by the
// source-qualified post key, never by the bare numeric id.
export const STORES = Object.freeze({
  likes: 'key',
  hearts: 'key',
  tag_stats: 'tag',
  preferences: 'key'
});

// Credentials live in `preferences` behind a reserved prefix so a single store
// covers them, and the backup allowlist can exclude them by prefix.
const CREDENTIAL_PREFIX = '__credentials:';

export class StorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StorageError';
    this.kind = 'storage';
    this.cause = cause;
  }
}

function assertStore(name) {
  if (!Object.prototype.hasOwnProperty.call(STORES, name)) {
    throw new StorageError('Unknown store: ' + String(name));
  }
  return name;
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export const storage = {
  conn: null,

  open(indexedDBImpl) {
    const idb = indexedDBImpl || (typeof indexedDB !== 'undefined' ? indexedDB : null);
    if (!idb) return Promise.reject(new StorageError('This device has no local database'));
    if (this.conn) return Promise.resolve(this.conn);

    return new Promise((resolve, reject) => {
      let req;
      try {
        req = idb.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(new StorageError('Local storage could not be opened', e));
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => {
        this.conn = req.result;
        this.conn.onversionchange = () => this.close();
        resolve(this.conn);
      };
      req.onerror = () => reject(new StorageError('Local storage could not be opened', req.error));
      req.onblocked = () => reject(new StorageError('Local storage is in use by another tab'));
    });
  },

  close() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
  },

  db() {
    if (!this.conn) throw new StorageError('Local storage is not open');
    return this.conn;
  },

  async get(store, key) {
    assertStore(store);
    const tx = this.db().transaction(store, 'readonly');
    const result = await promisify(tx.objectStore(store).get(key));
    return result === undefined ? null : result;
  },

  async all(store) {
    assertStore(store);
    const tx = this.db().transaction(store, 'readonly');
    const rows = await promisify(tx.objectStore(store).getAll());
    return Array.isArray(rows) ? rows : [];
  },

  // Writes resolve only once the transaction has actually committed, so a
  // caller can never flip the UI to "saved" on a write that later aborted.
  async put(store, value) {
    assertStore(store);
    const tx = this.db().transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await txDone(tx);
    return value;
  },

  async del(store, key) {
    assertStore(store);
    const tx = this.db().transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await txDone(tx);
  },

  async clear(store) {
    assertStore(store);
    const tx = this.db().transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await txDone(tx);
  },

  /** Saved posts for one source only, newest first. */
  async postsBySource(store, source) {
    assertSource(source);
    const rows = await this.all(store);
    return rows
      .filter(row => row && row.source === source)
      .sort((a, b) => (Number(b.date) || 0) - (Number(a.date) || 0));
  },

  async allPreferences() {
    const rows = await this.all('preferences');
    const out = {};
    for (const row of rows) {
      if (!row || typeof row.key !== 'string') continue;
      if (row.key.startsWith(CREDENTIAL_PREFIX)) continue;
      out[row.key] = row.value;
    }
    return out;
  },

  setPreference(key, value) {
    if (typeof key !== 'string' || !key || key.startsWith(CREDENTIAL_PREFIX)) {
      return Promise.reject(new StorageError('Invalid preference key'));
    }
    return this.put('preferences', { key, value });
  },

  async getCredentials(source) {
    assertSource(source);
    const row = await this.get('preferences', CREDENTIAL_PREFIX + source);
    const value = row && row.value ? row.value : {};
    return { uid: String(value.uid || ''), key: String(value.key || '') };
  },

  // Credentials are a pair: a lone user id or a lone key is never usable, and
  // storing half of one silently breaks every later request.
  async setCredentials(source, credentials) {
    assertSource(source);
    const uid = String((credentials && credentials.uid) || '').trim();
    const key = String((credentials && credentials.key) || '').trim();
    if ((uid && !key) || (key && !uid)) {
      return Promise.reject(new StorageError('Enter both the user ID and the API key, or clear both'));
    }
    return this.put('preferences', { key: CREDENTIAL_PREFIX + source, value: { uid, key } });
  },

  async clearCredentials(source) {
    assertSource(source);
    return this.del('preferences', CREDENTIAL_PREFIX + source);
  },

  async bumpTagStats(tags, weight) {
    if (!Array.isArray(tags) || tags.length === 0) return;
    const amount = Number(weight) || 0;
    if (!amount) return;
    const tx = this.db().transaction('tag_stats', 'readwrite');
    const store = tx.objectStore('tag_stats');
    for (const raw of tags) {
      const tag = String(raw || '').trim().toLowerCase();
      if (!tag) continue;
      const existing = await promisify(store.get(tag));
      const row = existing || { tag, score: 0 };
      row.score = (Number(row.score) || 0) + amount;
      store.put(row);
    }
    await txDone(tx);
  },

  /**
   * Replace the stores named in `snapshot` in a single transaction. A failure
   * anywhere aborts the whole import, so a bad backup file cannot leave half of
   * the previous data behind. Credentials are never touched.
   */
  async replaceStores(snapshot) {
    const names = Object.keys(snapshot).filter(name => Object.prototype.hasOwnProperty.call(STORES, name));
    if (names.length === 0) return;

    const tx = this.db().transaction(names, 'readwrite');
    for (const name of names) {
      const store = tx.objectStore(name);
      if (name === 'preferences') {
        // Keep the reserved credential records: they are deliberately outside
        // the backup format and must survive a restore.
        const existing = await promisify(store.getAll());
        for (const row of existing) {
          if (row && typeof row.key === 'string' && !row.key.startsWith(CREDENTIAL_PREFIX)) {
            store.delete(row.key);
          }
        }
      } else {
        store.clear();
      }
      for (const row of snapshot[name]) store.put(row);
    }
    await txDone(tx);
  }
};

export { CREDENTIAL_PREFIX, splitKey };
