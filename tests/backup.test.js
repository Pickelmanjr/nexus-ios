import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { storage } from '../src/storage.js';
import { validateSnapshot, exportSnapshot, importSnapshot, BackupError, BACKUP_FORMAT, BACKUP_VERSION } from '../src/backup.js';

const POST = {
  key: 'r34:42',
  id: '42',
  source: 'r34',
  file_url: 'https://wimg.rule34.xxx/images/1/a.jpg',
  sample_url: '',
  preview_url: 'https://wimg.rule34.xxx/thumbnails/1/t.jpg',
  tags: 'cat dog',
  width: 100,
  height: 200,
  score: 3,
  rating: 'safe',
  kind: 'image',
  date: 1700000000000
};

function snapshot(overrides = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    settings: { vol: 0.5, muted: false, autoplayVideos: true, gridSize: 'large', blurThumbs: false, themeColor: '#ff0055', themeRgb: '255,0,85' },
    infiniteScroll: false,
    blacklist: ['blocked'],
    favorites: ['cat'],
    tracked: ['dog'],
    savedTags: ['bird'],
    searchHistory: [{ query: 'cat', source: 'r34', ts: 1 }],
    seenIds: ['r34:9'],
    likes: [POST],
    hearts: [{ ...POST, key: 'gel:42', source: 'gel' }],
    stats: [{ tag: 'cat', score: 12 }],
    ...overrides
  };
}

async function freshStorage() {
  storage.close();
  await storage.open(new IDBFactory());
}

test.beforeEach(async () => { await freshStorage(); });
test.after(() => storage.close());

test('a full snapshot round-trips every retained field', () => {
  const data = validateSnapshot(snapshot());
  assert.deepEqual(data.favorites, ['cat']);
  assert.deepEqual(data.blacklist, ['blocked']);
  assert.deepEqual(data.tracked, ['dog']);
  assert.deepEqual(data.savedTags, ['bird']);
  assert.deepEqual(data.seenIds, ['r34:9']);
  assert.equal(data.settings.gridSize, 'large');
  assert.equal(data.infiniteScroll, false);
  assert.equal(data.likes[0].key, 'r34:42');
  assert.equal(data.hearts[0].source, 'gel');
  assert.deepEqual(data.stats, [{ tag: 'cat', score: 12 }]);
  assert.equal(data.searchHistory[0].query, 'cat');
});

test('an export contains no credentials and only allowlisted settings', async () => {
  await storage.setCredentials('r34', { uid: '999', key: 'private-key-value' });
  await storage.put('likes', POST);

  const app = {
    settings: { vol: 1, muted: true, autoplayVideos: true, gridSize: 'medium', blurThumbs: false, themeColor: '#ff0055', themeRgb: '255,0,85', secretField: 'nope' },
    infiniteScroll: true,
    blacklist: [], favorites: [], tracked: [], savedTags: [], searchHistory: [],
    seenIds: new Set(['r34:42'])
  };
  const out = await exportSnapshot(app);
  const text = JSON.stringify(out);

  assert.ok(!text.includes('private-key-value'), 'no API key in an export');
  assert.ok(!text.includes('999'), 'no user id in an export');
  assert.ok(!text.includes('secretField'), 'only allowlisted settings are exported');
  assert.equal(out.format, BACKUP_FORMAT);
  assert.equal(out.likes.length, 1);

  // And it must survive its own validator.
  assert.doesNotThrow(() => validateSnapshot(out));
});

test('an unversioned desktop backup with source-less ids is refused, not guessed', () => {
  const desktop = { favorites: ['cat'], likes: [{ id: 42, file_url: 'https://wimg.rule34.xxx/a.jpg' }] };
  assert.throws(() => validateSnapshot(desktop), /only imports its own export/);

  assert.throws(() => validateSnapshot(snapshot({ version: 2 })), /Unsupported backup version/);
  assert.throws(() => validateSnapshot(snapshot({ format: 'nexus-desktop' })), BackupError);
});

test('posts without a supported source or a matching key are refused', () => {
  assert.throws(() => validateSnapshot(snapshot({ likes: [{ ...POST, source: 'f95' }] })), /no supported source/);
  assert.throws(() => validateSnapshot(snapshot({ likes: [{ ...POST, source: undefined }] })), /no supported source/);
  assert.throws(() => validateSnapshot(snapshot({ likes: [{ ...POST, key: 'gel:42' }] })), /key does not match/);
  assert.throws(() => validateSnapshot(snapshot({ likes: [{ ...POST, id: '' }] })), /no id/);
});

test('unsafe media urls and unknown fields are rejected', () => {
  assert.throws(() => validateSnapshot(snapshot({
    likes: [{ ...POST, file_url: 'javascript:alert(1)', sample_url: '', preview_url: '' }]
  })), /no usable media address/);

  assert.throws(() => validateSnapshot(snapshot({ unexpectedField: 1 })), /unknown field/);
});

test('prototype-polluting keys in backup json are refused', () => {
  // A backup arrives as text, and JSON.parse does create a real own
  // "__proto__" key -- unlike an object literal, where it sets the prototype.
  const text = JSON.stringify(snapshot()).replace(
    '"likes":[{',
    '"likes":[{"__proto__":{"polluted":true},'
  );
  const parsed = JSON.parse(text);
  assert.ok(Object.prototype.hasOwnProperty.call(parsed.likes[0], '__proto__'), 'fixture really carries the key');
  assert.throws(() => validateSnapshot(text), /forbidden field/);
  assert.equal({}.polluted, undefined, 'nothing was polluted along the way');
});

test('an off-domain media url is stripped but a post keeps its other addresses', () => {
  const data = validateSnapshot(snapshot({
    likes: [{ ...POST, file_url: 'https://evil.test/a.jpg' }]
  }));
  assert.equal(data.likes[0].file_url, '', 'the disallowed address is dropped');
  assert.equal(data.likes[0].preview_url, POST.preview_url, 'the allowed one survives');
});

test('duplicate keys collapse and oversized payloads are refused', () => {
  const data = validateSnapshot(snapshot({ likes: [POST, { ...POST }] }));
  assert.equal(data.likes.length, 1);

  assert.throws(() => validateSnapshot(snapshot({
    likes: Array.from({ length: 10001 }, (_, i) => ({ ...POST, id: String(i), key: `r34:${i}` }))
  })), /more than 10000/);

  assert.throws(() => validateSnapshot('x'.repeat(11 * 1024 * 1024)), /too large/);
  assert.throws(() => validateSnapshot('{not json'), /not valid JSON/);
  assert.throws(() => validateSnapshot(snapshot({ favorites: ['a'.repeat(600)] })), /unreasonably long/);
});

test('out-of-range settings and non-finite scores are refused', () => {
  assert.throws(() => validateSnapshot(snapshot({ settings: { vol: 4 } })), /between 0 and 1/);
  assert.throws(() => validateSnapshot(snapshot({ settings: { gridSize: 'enormous' } })), /not a known size/);
  assert.throws(() => validateSnapshot(snapshot({ settings: { muted: 'yes' } })), /true or false/);
  assert.throws(() => validateSnapshot(snapshot({ stats: [{ tag: 'cat', score: 'lots' }] })), /non-numeric score/);
  assert.throws(() => validateSnapshot(snapshot({ blacklist: 'cat' })), /must be a list/);
});

test('a successful import replaces the previous data', async () => {
  await storage.put('likes', { key: 'gel:1', id: '1', source: 'gel' });
  await storage.setPreference('favorites', ['stale']);

  await importSnapshot(snapshot());

  assert.deepEqual((await storage.all('likes')).map(r => r.key), ['r34:42']);
  assert.deepEqual((await storage.allPreferences()).favorites, ['cat']);
  assert.deepEqual((await storage.all('tag_stats')).map(r => r.tag), ['cat']);
});

test('a malformed import changes nothing at all', async () => {
  await storage.put('likes', { key: 'gel:1', id: '1', source: 'gel' });
  await storage.setPreference('favorites', ['keep-me']);

  await assert.rejects(() => importSnapshot(snapshot({ likes: [{ ...POST, source: 'f95' }] })), BackupError);
  await assert.rejects(() => importSnapshot('{not json'), BackupError);
  await assert.rejects(() => importSnapshot({ favorites: ['x'] }), BackupError);

  assert.deepEqual((await storage.all('likes')).map(r => r.key), ['gel:1']);
  assert.deepEqual((await storage.allPreferences()).favorites, ['keep-me']);
});

test('an import never touches the stored accounts', async () => {
  await storage.setCredentials('gel', { uid: '5', key: 'kept' });
  await importSnapshot(snapshot());
  assert.deepEqual(await storage.getCredentials('gel'), { uid: '5', key: 'kept' });
});
