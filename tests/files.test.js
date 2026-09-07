import test from 'node:test';
import assert from 'node:assert/strict';

import { saveJsonFile, saveMediaFile, cleanStaleCache, setFilePlugins, FileError } from '../src/files.js';

const MEDIA = 'https://wimg.rule34.xxx/images/1/a.mp4';

function mockPlugins(overrides = {}) {
  const calls = [];
  const api = {
    Directory: { Cache: 'CACHE' },
    Filesystem: {
      mkdir: async (opts) => { calls.push(['mkdir', opts]); },
      writeFile: async (opts) => { calls.push(['writeFile', opts]); },
      getUri: async (opts) => { calls.push(['getUri', opts]); return { uri: 'file:///cache/' + opts.path }; },
      readdir: async (opts) => { calls.push(['readdir', opts]); return { files: [] }; },
      deleteFile: async (opts) => { calls.push(['deleteFile', opts]); }
    },
    FileTransfer: {
      downloadFile: async (opts) => { calls.push(['downloadFile', opts]); }
    },
    Share: {
      share: async (opts) => { calls.push(['share', opts]); }
    },
    ...overrides
  };
  setFilePlugins(api);
  return { calls, api };
}

test.afterEach(() => setFilePlugins(null));

test('a json export is written as utf8 then shared, in that order', async () => {
  const { calls } = mockPlugins();
  const result = await saveJsonFile('nexus-backup-2026-09-07.json', '{"format":"nexus-ios"}');

  const order = calls.map(c => c[0]);
  assert.deepEqual(order, ['mkdir', 'writeFile', 'getUri', 'share']);
  assert.equal(calls[1][1].encoding, 'utf8', 'written as text, not base64');
  assert.equal(calls[1][1].directory, 'CACHE');
  assert.deepEqual(calls[3][1].files, ['file:///cache/nexus-exports/nexus-backup-2026-09-07.json']);
  assert.deepEqual(result, { saved: true, shared: true, uri: 'file:///cache/nexus-exports/nexus-backup-2026-09-07.json' });
});

test('a cancelled share still counts as saved, not as a failed export', async () => {
  mockPlugins({ Share: { share: async () => { throw new Error('User cancelled'); } } });
  const result = await saveJsonFile('x.json', '{}');
  assert.equal(result.saved, true);
  assert.equal(result.shared, false);
});

test('media downloads natively to a file uri and is then shared', async () => {
  const { calls } = mockPlugins();
  const result = await saveMediaFile(MEDIA, 'r34-1001');

  const order = calls.map(c => c[0]);
  assert.deepEqual(order, ['mkdir', 'getUri', 'downloadFile', 'share']);
  const download = calls.find(c => c[0] === 'downloadFile')[1];
  assert.equal(download.url, MEDIA);
  assert.equal(download.path, 'file:///cache/nexus-exports/r34-1001');
  assert.ok(!('data' in download), 'no base64 payload crosses the bridge');
  assert.equal(result.shared, true);
});

test('a disallowed media address never reaches the download plugin', async () => {
  const { calls } = mockPlugins();
  for (const bad of ['https://evil.test/a.mp4', 'javascript:alert(1)', 'file:///etc/passwd', '']) {
    await assert.rejects(() => saveMediaFile(bad, 'x'), err => err instanceof FileError && err.kind === 'denied');
  }
  assert.equal(calls.length, 0);
});

test('only one download runs at a time', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  mockPlugins({
    FileTransfer: { downloadFile: async () => { await pending; } }
  });

  const first = saveMediaFile(MEDIA, 'one');
  await assert.rejects(() => saveMediaFile(MEDIA, 'two'), err => err.kind === 'busy');

  release();
  await first;

  // The guard clears once the first download settles.
  await assert.doesNotReject(() => saveMediaFile(MEDIA, 'three'));
});

test('the guard clears even when a download fails', async () => {
  mockPlugins({ FileTransfer: { downloadFile: async () => { throw new Error('network gone'); } } });
  await assert.rejects(() => saveMediaFile(MEDIA, 'one'), err => err.kind === 'download');

  mockPlugins();
  await assert.doesNotReject(() => saveMediaFile(MEDIA, 'two'));
});

test('filenames are sanitised into the export folder', async () => {
  const { calls } = mockPlugins();
  await saveMediaFile(MEDIA, '../../escape/../../etc/passwd');
  const uri = calls.find(c => c[0] === 'getUri')[1].path;
  assert.ok(uri.startsWith('nexus-exports/'), uri);
  assert.ok(!uri.includes('..'), uri);
});

test('stale export files are removed but recent ones are kept', async () => {
  const now = Date.now();
  const { calls } = mockPlugins({
    Filesystem: {
      mkdir: async () => {},
      writeFile: async () => {},
      getUri: async () => ({ uri: 'x' }),
      readdir: async () => ({
        files: [
          { name: 'old.json', mtime: now - (48 * 60 * 60 * 1000) },
          { name: 'fresh.json', mtime: now - 1000 }
        ]
      }),
      deleteFile: async (opts) => { calls.push(['deleteFile', opts]); }
    }
  });

  const removed = await cleanStaleCache(now);
  assert.equal(removed, 1);
  assert.equal(calls.filter(c => c[0] === 'deleteFile').length, 1);
  assert.ok(calls.find(c => c[0] === 'deleteFile')[1].path.endsWith('old.json'));
});

test('cache cleanup is silent when the folder does not exist yet', async () => {
  mockPlugins({
    Filesystem: {
      mkdir: async () => {},
      writeFile: async () => {},
      getUri: async () => ({ uri: 'x' }),
      readdir: async () => { throw new Error('no such directory'); },
      deleteFile: async () => {}
    }
  });
  assert.equal(await cleanStaleCache(), 0);
});
