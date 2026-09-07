// The only two sources this build knows about. Everything downstream -- network,
// storage, backup, deep links -- funnels through `assertSource`, so an unknown
// identifier cannot reach a request builder or a database key.

export const SOURCES = Object.freeze({
  r34: Object.freeze({
    id: 'r34',
    label: 'Rule34',
    api: 'https://api.rule34.xxx',
    site: 'https://rule34.xxx',
    accent: '#ff0055',
    accentRgb: '255,0,85',
    topSort: 'sort:score:desc',
    defaultTags: 'all'
  }),
  gel: Object.freeze({
    id: 'gel',
    label: 'Gelbooru',
    api: 'https://gelbooru.com',
    site: 'https://gelbooru.com',
    accent: '#0088ff',
    accentRgb: '0,136,255',
    topSort: 'sort:score',
    defaultTags: ''
  })
});

const MEDIA_HOSTS = ['rule34.xxx', 'gelbooru.com'];
const API_ORIGINS = ['https://api.rule34.xxx', 'https://gelbooru.com'];

export class SourceError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'SourceError';
    this.kind = kind;
  }
}

export function isSource(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCES, value);
}

export function assertSource(value) {
  if (!isSource(value)) {
    throw new SourceError('unsupported-source', 'Unsupported source: ' + String(value));
  }
  return SOURCES[value];
}

// Store and DOM identity. Rule34 post 42 and Gelbooru post 42 are different
// posts, so the numeric id alone must never be used as a key.
export function postKey(source, id) {
  assertSource(source);
  const raw = String(id === undefined || id === null ? '' : id).trim();
  if (!raw) throw new SourceError('invalid-post', 'Post is missing an id');
  return source + ':' + raw;
}

export function splitKey(key) {
  const raw = String(key || '');
  const at = raw.indexOf(':');
  if (at < 1) return null;
  const source = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!isSource(source) || !id) return null;
  return { source, id };
}

function credentialPair(credentials) {
  if (!credentials) return null;
  const uid = String(credentials.uid || '').trim();
  const key = String(credentials.key || '').trim();
  if (!uid || !key) return null;
  return { uid, key };
}

function applyCredentials(url, credentials) {
  const pair = credentialPair(credentials);
  if (!pair) return url;
  url.searchParams.set('user_id', pair.uid);
  url.searchParams.set('api_key', pair.key);
  return url;
}

function tagString(query, source, sort) {
  const conf = SOURCES[source];
  const terms = String(query || '').trim().split(/\s+/).filter(Boolean);
  if (sort === 'top') terms.push(conf.topSort);
  else if (sort === 'old') terms.push('sort:id:asc');
  if (terms.length === 0 && conf.defaultTags) terms.push(conf.defaultTags);
  // URLSearchParams encodes the joining spaces as `+`, which is what both DAPI
  // endpoints expect. Encoding here as well would double-encode the tags.
  return terms.join(' ');
}

function dapiUrl(source) {
  const url = new URL(SOURCES[source].api + '/index.php');
  url.searchParams.set('page', 'dapi');
  url.searchParams.set('s', 'post');
  url.searchParams.set('q', 'index');
  return url;
}

export function buildPostsUrl(source, options = {}, credentials = null) {
  assertSource(source);
  const { query = '', sort = 'new', page = 0, limit = 20, extraTags = '' } = options;
  const pid = Number(page);
  if (!Number.isInteger(pid) || pid < 0) {
    throw new SourceError('invalid-request', 'Page must be a zero-based integer');
  }
  const url = dapiUrl(source);
  url.searchParams.set('json', '1');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('pid', String(pid));
  const merged = [tagString(query, source, sort), extraTags].filter(Boolean).join(' ');
  url.searchParams.set('tags', merged);
  return applyCredentials(url, credentials).href;
}

// Rule34 reports the total match count only through the XML DAPI with limit=0.
export function buildCountUrl(source, query, credentials = null) {
  assertSource(source);
  if (source !== 'r34') throw new SourceError('invalid-request', 'Count endpoint is Rule34 only');
  const url = dapiUrl('r34');
  url.searchParams.set('limit', '0');
  url.searchParams.set('pid', '0');
  url.searchParams.set('tags', tagString(query, 'r34', 'new'));
  return applyCredentials(url, credentials).href;
}

export function buildAutocompleteUrl(source, term, credentials = null) {
  assertSource(source);
  const value = String(term || '').trim();
  if (!value) throw new SourceError('invalid-request', 'Autocomplete needs a term');
  if (source === 'r34') {
    const url = new URL(SOURCES.r34.api + '/autocomplete.php');
    url.searchParams.set('q', value);
    return url.href;
  }
  const url = new URL(SOURCES.gel.api + '/index.php');
  url.searchParams.set('page', 'autocomplete2');
  url.searchParams.set('term', value);
  url.searchParams.set('type', 'tag_query');
  url.searchParams.set('limit', '25');
  return applyCredentials(url, credentials).href;
}

export function buildTagCategoryUrl(source, tag, credentials = null) {
  assertSource(source);
  const value = String(tag || '').trim();
  if (!value) throw new SourceError('invalid-request', 'Tag lookup needs a tag');
  if (source === 'gel') return buildAutocompleteUrl('gel', value, credentials);
  const url = new URL(SOURCES.r34.api + '/index.php');
  url.searchParams.set('page', 'dapi');
  url.searchParams.set('s', 'tag');
  url.searchParams.set('q', 'index');
  url.searchParams.set('name', value);
  return applyCredentials(url, credentials).href;
}

export function buildPostLink(source, id) {
  assertSource(source);
  const url = new URL(SOURCES[source].site + '/index.php');
  url.searchParams.set('page', 'post');
  url.searchParams.set('s', 'view');
  url.searchParams.set('id', String(id));
  return url.href;
}

export function isApiUrl(value) {
  try {
    const url = new URL(String(value));
    return API_ORIGINS.includes(url.origin);
  } catch (e) {
    return false;
  }
}

// Media comes straight from the source CDNs into <img>/<video>. Anything that is
// not a plain https URL on one of the two source domain families is rejected
// rather than handed to the web view.
export function safeMediaUrl(value) {
  let raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) raw = 'https:' + raw;
  let url;
  try {
    url = new URL(raw);
  } catch (e) {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  if (url.username || url.password) return '';
  if (url.port && url.port !== '443') return '';
  const host = url.hostname.toLowerCase();
  const allowed = MEDIA_HOSTS.some(base => host === base || host.endsWith('.' + base));
  return allowed ? url.href : '';
}

function looksLikeChallenge(text) {
  return /<\s*(html|!doctype)|just a moment|cloudflare|enable javascript/i.test(text);
}

function coerceJson(data) {
  if (typeof data !== 'string') return data;
  const trimmed = data.trim();
  if (!trimmed) return [];
  if (looksLikeChallenge(trimmed)) {
    throw new SourceError('blocked', 'The source returned a web page instead of data');
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new SourceError('invalid-format', 'The source returned data this app could not read');
  }
}

function rejectAuthShape(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const message = String(data.message || data.error || '');
  if (data.success === false || message) {
    if (/authenticat|api key|user_id|credential|login/i.test(message)) {
      throw new SourceError('auth', 'The source rejected your account details');
    }
    throw new SourceError('source-error', message || 'The source reported an error');
  }
}

/**
 * Turn a raw API body into normalized posts. A valid empty result is success;
 * anything unrecognized throws, so a failed request can never be rendered as
 * "no results".
 */
export function parsePosts(source, raw) {
  assertSource(source);
  const data = coerceJson(raw);

  if (Array.isArray(data)) return data.map(post => normalizePost(source, post)).filter(Boolean);

  rejectAuthShape(data);

  if (data && typeof data === 'object') {
    if (Array.isArray(data.post)) {
      return data.post.map(post => normalizePost(source, post)).filter(Boolean);
    }
    // Gelbooru answers an empty search with a count envelope and no `post` key.
    // Only an explicit zero is safe to read as "no results".
    const attrs = data['@attributes'];
    const count = attrs && attrs.count !== undefined ? Number(attrs.count) : undefined;
    if (count === 0) return [];
  }

  throw new SourceError('invalid-format', 'The source returned an unexpected response');
}

export function parseCountEnvelope(raw) {
  const data = coerceJson(raw);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const attrs = data['@attributes'];
    if (attrs && attrs.count !== undefined) {
      const n = Number(attrs.count);
      if (Number.isFinite(n)) return n;
    }
    if (data.count !== undefined) {
      const n = Number(data.count);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// Rule34's count lives in an XML attribute. Read it with a regex rather than
// pulling in an XML parser purely to reach one number.
export function parseCount(text) {
  const match = String(text || '').match(/<posts\b[^>]*\bcount=["'](\d+)["']/i);
  return match ? Number(match[1]) : null;
}

export function parseAutocomplete(source, raw) {
  assertSource(source);
  const data = coerceJson(raw);
  const list = Array.isArray(data)
    ? data
    : (data && Array.isArray(data.results) ? data.results : null);
  if (!list) throw new SourceError('invalid-format', 'Tag suggestions came back unreadable');

  return list.map(item => {
    if (typeof item === 'string') return { name: item.trim(), count: '', category: '' };
    let name = String(item.name || item.value || item.tag || item.label || '').trim();
    name = name.replace(/\s*\(\d+\)\s*$/, '');
    const labelCount = typeof item.label === 'string' ? item.label.match(/\((\d+)\)/) : null;
    const count = item.count || item.post_count || (labelCount ? labelCount[1] : '');
    return { name, count: String(count || ''), category: String(item.category || item.type || '') };
  }).filter(item => item.name);
}

export function tagCategoryFromType(type) {
  const key = String(type === undefined || type === null ? '' : type).trim().toLowerCase();
  if (['3', 'copyright'].includes(key)) return 'Copyright';
  if (['4', 'character'].includes(key)) return 'Character';
  if (['1', 'artist'].includes(key)) return 'Artist';
  if (['5', 'meta', 'metadata'].includes(key)) return 'Meta';
  return 'General';
}

export function parseTagCategory(source, raw, tag) {
  assertSource(source);
  const wanted = String(tag || '').trim().toLowerCase();
  if (!wanted) return null;

  if (source === 'gel') {
    const list = parseAutocomplete('gel', raw);
    const exact = list.find(item => item.name.toLowerCase() === wanted);
    return exact && exact.category ? tagCategoryFromType(exact.category) : null;
  }

  // Rule34 answers the tag DAPI in XML. DOMParser only exists in the web view,
  // so callers on other platforms simply get no category.
  if (typeof DOMParser === 'undefined' || typeof raw !== 'string') return null;
  const doc = new DOMParser().parseFromString(raw, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new SourceError('invalid-format', 'Tag data came back unreadable');
  }
  const el = Array.from(doc.querySelectorAll('tag'))
    .find(node => String(node.getAttribute('name') || '').toLowerCase() === wanted);
  return el ? tagCategoryFromType(el.getAttribute('type')) : null;
}

const VIDEO_EXT = /\.(mp4|webm|m4v|mov|ogv)(?:\?.*)?$/i;
const GIF_EXT = /\.gif(?:\?.*)?$/i;

export function mediaKind(url) {
  if (VIDEO_EXT.test(url || '')) return 'video';
  if (GIF_EXT.test(url || '')) return 'gif';
  return 'image';
}

export function videoMimeType(url) {
  const match = String(url || '').match(/\.(mp4|webm|m4v|mov|ogv)(?:\?.*)?$/i);
  if (!match) return '';
  const ext = match[1].toLowerCase();
  if (ext === 'webm') return 'video/webm';
  if (ext === 'ogv') return 'video/ogg';
  if (ext === 'mov') return 'video/quicktime';
  return 'video/mp4';
}

/**
 * Reduce a raw API post to the fields this app actually renders, with a
 * source-qualified key. Posts with no usable media URL are dropped instead of
 * being given a synthetic one.
 */
export function normalizePost(source, raw) {
  assertSource(source);
  if (!raw || typeof raw !== 'object') return null;

  const id = String(raw.id === undefined || raw.id === null ? '' : raw.id).trim();
  if (!id) return null;

  const fileUrl = safeMediaUrl(raw.file_url || raw.url || '');
  const sampleUrl = safeMediaUrl(raw.sample_url || '');
  const previewUrl = safeMediaUrl(raw.preview_url || '');
  if (!fileUrl && !sampleUrl && !previewUrl) return null;

  const tags = typeof raw.tags === 'string'
    ? raw.tags
    : (Array.isArray(raw.tags) ? raw.tags.join(' ') : '');

  return {
    id,
    source,
    key: postKey(source, id),
    file_url: fileUrl,
    sample_url: sampleUrl,
    preview_url: previewUrl,
    tags,
    width: Number(raw.width) || 0,
    height: Number(raw.height) || 0,
    score: Number(raw.score) || 0,
    rating: String(raw.rating || ''),
    kind: mediaKind(fileUrl || sampleUrl)
  };
}
