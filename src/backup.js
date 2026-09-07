import { isSource, postKey, safeMediaUrl, splitKey } from './sources.js';
import { storage } from './storage.js';

export const BACKUP_FORMAT = 'nexus-ios';
export const BACKUP_VERSION = 1;

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_POSTS = 10000;
const MAX_LIST = 5000;
const MAX_STRING = 512;

// Settings are copied field by field. An allowlist is the only reason a future
// credential-shaped key cannot ride into an export.
const SETTING_KEYS = Object.freeze([
  'vol', 'muted', 'autoplayVideos', 'gridSize', 'blurThumbs', 'themeColor', 'themeRgb'
]);

const TOP_LEVEL_KEYS = Object.freeze([
  'format', 'version', 'exportedAt', 'settings', 'infiniteScroll', 'blacklist', 'favorites',
  'tracked', 'savedTags', 'searchHistory', 'seenIds', 'likes', 'hearts', 'stats'
]);

const FORBIDDEN_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);

export class BackupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupError';
    this.kind = 'backup';
  }
}

function fail(message) {
  throw new BackupError(message);
}

function cleanString(value, label) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  if (raw.length > MAX_STRING) fail(label + ' contains an unreasonably long value');
  return raw;
}

function cleanTagList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(label + ' must be a list');
  if (value.length > MAX_LIST) fail(label + ' has too many entries');
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const tag = cleanString(item, label).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

function cleanSettings(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('settings must be an object');
  const out = {};
  for (const key of SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const raw = value[key];
    if (key === 'vol') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 1) fail('settings.vol must be between 0 and 1');
      out.vol = n;
    } else if (['muted', 'autoplayVideos', 'blurThumbs'].includes(key)) {
      if (typeof raw !== 'boolean') fail('settings.' + key + ' must be true or false');
      out[key] = raw;
    } else if (key === 'gridSize') {
      if (!['small', 'medium', 'large'].includes(raw)) fail('settings.gridSize is not a known size');
      out.gridSize = raw;
    } else {
      const text = cleanString(raw, 'settings.' + key);
      if (text && !/^[#0-9a-zA-Z,.\s()-]+$/.test(text)) fail('settings.' + key + ' has unexpected characters');
      out[key] = text;
    }
  }
  return out;
}

function cleanPost(raw, label) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail(label + ' contains a non-post entry');
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) fail(label + ' contains a forbidden field');
  }

  // Desktop exports keyed posts by a bare numeric id with no record of which
  // booru it came from. Guessing would silently mix the two vaults, so those
  // files are rejected rather than migrated.
  const source = typeof raw.source === 'string' ? raw.source : '';
  if (!isSource(source)) fail(label + ' has an entry with no supported source');

  const id = cleanString(raw.id, label + ' id');
  if (!id) fail(label + ' has an entry with no id');

  const key = typeof raw.key === 'string' ? raw.key : postKey(source, id);
  const parts = splitKey(key);
  if (!parts || parts.source !== source || parts.id !== id) fail(label + ' has an entry whose key does not match its id');

  const post = {
    key,
    id,
    source,
    file_url: safeMediaUrl(raw.file_url),
    sample_url: safeMediaUrl(raw.sample_url),
    preview_url: safeMediaUrl(raw.preview_url),
    tags: typeof raw.tags === 'string' ? raw.tags.slice(0, 4000) : '',
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    score: Number(raw.score) || 0,
    rating: cleanString(raw.rating, label + ' rating'),
    kind: ['video', 'gif', 'image'].includes(raw.kind) ? raw.kind : 'image',
    date: Number.isFinite(Number(raw.date)) ? Number(raw.date) : Date.now()
  };
  if (!post.file_url && !post.sample_url && !post.preview_url) {
    fail(label + ' has an entry with no usable media address');
  }
  return post;
}

function cleanPostList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(label + ' must be a list');
  if (value.length > MAX_POSTS) fail(label + ' has more than ' + MAX_POSTS + ' entries');
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const post = cleanPost(raw, label);
    if (seen.has(post.key)) continue;
    seen.add(post.key);
    out.push(post);
  }
  return out;
}

function cleanStats(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('stats must be a list');
  if (value.length > MAX_LIST) fail('stats has too many entries');
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') fail('stats contains a non-object entry');
    const tag = cleanString(raw.tag, 'stats tag').toLowerCase();
    const score = Number(raw.score);
    if (!tag || seen.has(tag)) continue;
    if (!Number.isFinite(score)) fail('stats has a non-numeric score');
    seen.add(tag);
    out.push({ tag, score });
  }
  return out;
}

function cleanHistory(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('searchHistory must be a list');
  const out = [];
  for (const raw of value.slice(0, 100)) {
    const entry = typeof raw === 'string' ? { query: raw } : raw;
    if (!entry || typeof entry !== 'object') continue;
    const query = cleanString(entry.query, 'searchHistory');
    if (!query) continue;
    const source = isSource(entry.source) ? entry.source : (isSource(entry.mode) ? entry.mode : '');
    out.push({ query, source, ts: Number(entry.ts) || Date.now() });
  }
  return out;
}

function cleanKeyList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail('seenIds must be a list');
  const out = [];
  const seen = new Set();
  for (const raw of value.slice(0, MAX_POSTS)) {
    const key = typeof raw === 'string' ? raw : '';
    if (!splitKey(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * Validate an entire parsed backup before anything is written. Every failure
 * throws, so the caller reaches the import step only with data it can apply
 * whole.
 */
export function validateSnapshot(raw) {
  if (typeof raw === 'string') {
    if (raw.length > MAX_BYTES) fail('That backup file is too large to import');
    try {
      raw = JSON.parse(raw);
    } catch (e) {
      fail('That file is not valid JSON');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('That file is not a Nexus backup');

  if (raw.format !== BACKUP_FORMAT) {
    fail('Unsupported backup: this app only imports its own export (format "' + BACKUP_FORMAT + '").');
  }
  if (Number(raw.version) !== BACKUP_VERSION) {
    fail('Unsupported backup version: expected ' + BACKUP_VERSION + '.');
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(key)) fail('Backup contains an unknown field: ' + key);
  }

  return {
    settings: cleanSettings(raw.settings),
    infiniteScroll: raw.infiniteScroll === undefined ? true : Boolean(raw.infiniteScroll),
    blacklist: cleanTagList(raw.blacklist, 'blacklist'),
    favorites: cleanTagList(raw.favorites, 'favorites'),
    tracked: cleanTagList(raw.tracked, 'tracked'),
    savedTags: cleanTagList(raw.savedTags, 'savedTags'),
    searchHistory: cleanHistory(raw.searchHistory),
    seenIds: cleanKeyList(raw.seenIds),
    likes: cleanPostList(raw.likes, 'likes'),
    hearts: cleanPostList(raw.hearts, 'hearts'),
    stats: cleanStats(raw.stats)
  };
}

/** Build an export from the current app state plus the stores. */
export async function exportSnapshot(app) {
  const [likes, hearts, stats] = await Promise.all([
    storage.all('likes'),
    storage.all('hearts'),
    storage.all('tag_stats')
  ]);

  const settings = {};
  for (const key of SETTING_KEYS) settings[key] = app.settings[key];

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    settings,
    infiniteScroll: Boolean(app.infiniteScroll),
    blacklist: app.blacklist.slice(),
    favorites: app.favorites.slice(),
    tracked: app.tracked.slice(),
    savedTags: app.savedTags.slice(),
    searchHistory: app.searchHistory.slice(),
    seenIds: Array.from(app.seenIds),
    likes,
    hearts,
    stats
  };
}

/**
 * Apply a validated backup. Validation happens before the write transaction is
 * opened, and the write itself is atomic, so a cancelled or malformed import
 * leaves the previous data exactly as it was.
 */
export async function importSnapshot(raw) {
  const data = validateSnapshot(raw);

  await storage.replaceStores({
    likes: data.likes,
    hearts: data.hearts,
    tag_stats: data.stats,
    preferences: [
      { key: 'settings', value: data.settings },
      { key: 'infiniteScroll', value: data.infiniteScroll },
      { key: 'blacklist', value: data.blacklist },
      { key: 'favorites', value: data.favorites },
      { key: 'tracked', value: data.tracked },
      { key: 'savedTags', value: data.savedTags },
      { key: 'searchHistory', value: data.searchHistory },
      { key: 'seenIds', value: data.seenIds }
    ]
  });

  return data;
}
