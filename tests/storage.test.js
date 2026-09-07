import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

import { storage, STORES, DB_NAME, DB_VERSION, StorageError } from '../src/storage.js';

async function freshStorage() {
  storage.close();
  const factory = new IDBFactory();
  await storage.open(factory);
  return factory;
}

test.beforeEach(async () => { await freshStorage(); });
test.after(() => storage.close());

test('the schema holds exactly the four retained stores', () => {
  assert.deepEqual(Object.keys(STORES).sort(), ['hearts', 'likes', 'preferences', 'tag_stats']);
  assert.equal(DB_NAME, 'NexusIOS');
  assert.equal(DB_VERSION, 1);

  const names = Array.from(storage.db().objectStoreNames).sort();
  assert.deepEqual(names, ['hearts', 'likes', 'preferences', 'tag_stats']);
  for (const gone of ['local_media', 'game_likes', 'game_hearts', 'game_tag_stats', 'following']) {
    assert.ok(!names.includes(gone), `${gone} must not exist in this build`);
  }
});

test('an unknown store is refused rather than created on the fly', async () => {
  await assert.rejects(() => storage.get('game_likes', 'x'), StorageError);
  await assert.rejects(() => storage.put('local_media', { key: 'x' }), StorageError);
  await assert.rejects(() => storage.all('__proto__'), StorageError);
});

test('the same numeric id from each source is stored separately', async () => {
  await storage.put('likes', { key: 'r34:42', id: '42', source: 'r34', date: 1 });
  await storage.put('likes', { key: 'gel:42', id: '42', source: 'gel', date: 2 });

  assert.equal((await storage.all('likes')).length, 2);
  assert.equal((await storage.get('likes', 'r34:42')).source, 'r34');
  assert.equal((await storage.get('likes', 'gel:42')).source, 'gel');

  const r34Only = await storage.postsBySource('likes', 'r34');
  assert.deepEqual(r34Only.map(p => p.key), ['r34:42'], 'the vault shows one source at a time');
});

test('postsBySource orders newest first and rejects an unknown source', async () => {
  await storage.put('likes', { key: 'r34:1', id: '1', source: 'r34', date: 100 });
  await storage.put('likes', { key: 'r34:2', id: '2', source: 'r34', date: 300 });
  await storage.put('likes', { key: 'r34:3', id: '3', source: 'r34', date: 200 });
  const rows = await storage.postsBySource('likes', 'r34');
  assert.deepEqual(rows.map(p => p.id), ['2', '3', '1']);
  await assert.rejects(() => storage.postsBySource('likes', 'f95'));
});

test('data survives reopening the database', async () => {
  const factory = new IDBFactory();
  storage.close();
  await storage.open(factory);
  await storage.put('hearts', { key: 'gel:7', id: '7', source: 'gel' });
  await storage.setPreference('favorites', ['cat']);
  storage.close();

  await storage.open(factory);
  assert.equal((await storage.get('hearts', 'gel:7')).id, '7');
  assert.deepEqual((await storage.allPreferences()).favorites, ['cat']);
});

test('a write resolves only after the transaction commits', async () => {
  await storage.put('likes', { key: 'r34:5', id: '5', source: 'r34' });
  // If put() resolved before commit, this read could miss the row.
  assert.ok(await storage.get('likes', 'r34:5'));
});

test('a failed open rejects instead of half-starting the app', async () => {
  storage.close();
  const broken = {
    open() {
      const req = {};
      setTimeout(() => {
        req.error = new Error('quota');
        if (req.onerror) req.onerror();
      }, 0);
      return req;
    }
  };
  await assert.rejects(() => storage.open(broken), StorageError);
  storage.conn = null;
});

test('operations before open fail loudly', async () => {
  storage.close();
  await assert.rejects(() => storage.get('likes', 'r34:1'), StorageError);
  await freshStorage();
});

test('credentials are per source, complete pairs only, and stay out of preferences', async () => {
  assert.deepEqual(await storage.getCredentials('r34'), { uid: '', key: '' });

  await storage.setCredentials('r34', { uid: '111', key: 'aaa' });
  await storage.setCredentials('gel', { uid: '222', key: 'bbb' });

  assert.deepEqual(await storage.getCredentials('r34'), { uid: '111', key: 'aaa' });
  assert.deepEqual(await storage.getCredentials('gel'), { uid: '222', key: 'bbb' });

  await assert.rejects(() => storage.setCredentials('r34', { uid: '111', key: '' }), StorageError);
  await assert.rejects(() => storage.setCredentials('r34', { uid: '', key: 'aaa' }), StorageError);
  await assert.rejects(() => storage.setCredentials('f95', { uid: '1', key: '2' }));

  // Clearing both at once is deliberate and allowed.
  await storage.setCredentials('r34', { uid: '', key: '' });
  assert.deepEqual(await storage.getCredentials('r34'), { uid: '', key: '' });

  await storage.clearCredentials('gel');
  assert.deepEqual(await storage.getCredentials('gel'), { uid: '', key: '' });

  const prefs = await storage.allPreferences();
  const serialized = JSON.stringify(prefs);
  assert.ok(!serialized.includes('bbb'), 'no credential value may appear in exportable preferences');
  assert.ok(!Object.keys(prefs).some(k => k.includes('credential')));
});

test('a reserved credential key cannot be written through setPreference', async () => {
  await assert.rejects(() => storage.setPreference('__credentials:r34', { uid: 'x', key: 'y' }), StorageError);
  await assert.rejects(() => storage.setPreference('', 'x'), StorageError);
});

test('tag weights accumulate in one transaction', async () => {
  await storage.bumpTagStats(['cat', 'dog'], 5);
  await storage.bumpTagStats(['cat'], 3);
  const rows = await storage.all('tag_stats');
  const byTag = Object.fromEntries(rows.map(r => [r.tag, r.score]));
  assert.deepEqual(byTag, { cat: 8, dog: 5 });

  await storage.bumpTagStats([], 5);
  await storage.bumpTagStats(['cat'], 0);
  assert.equal((await storage.get('tag_stats', 'cat')).score, 8, 'a zero weight writes nothing');
});

test('replaceStores swaps data atomically and preserves credentials', async () => {
  await storage.setCredentials('r34', { uid: '111', key: 'aaa' });
  await storage.put('likes', { key: 'r34:old', id: 'old', source: 'r34' });
  await storage.setPreference('favorites', ['old-tag']);

  await storage.replaceStores({
    likes: [{ key: 'gel:new', id: 'new', source: 'gel' }],
    preferences: [{ key: 'favorites', value: ['new-tag'] }]
  });

  assert.deepEqual((await storage.all('likes')).map(r => r.key), ['gel:new']);
  assert.deepEqual((await storage.allPreferences()).favorites, ['new-tag']);
  assert.deepEqual(await storage.getCredentials('r34'), { uid: '111', key: 'aaa' },
    'a restore must not wipe the accounts the user configured');
});
