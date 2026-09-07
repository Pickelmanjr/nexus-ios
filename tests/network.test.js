import test from 'node:test';
import assert from 'node:assert/strict';

import { request, describeError, NetworkError, DEFAULT_TIMEOUT_MS } from '../src/network.js';
import { setTransport, resetTransport, getTransport, isNative } from '../src/platform.js';

const URL_OK = 'https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&tags=cat';
const SECRET = 'super-secret-api-key';

function fakeTransport(handler, kind = 'native') {
  const calls = [];
  return {
    calls,
    transport: {
      kind,
      async get(url, options) {
        calls.push({ url, options });
        return handler(url, options);
      }
    }
  };
}

test.afterEach(() => resetTransport());

test('requests outside the two api origins are refused before any transport runs', async () => {
  const fake = fakeTransport(() => ({ status: 200, body: '[]' }));
  setTransport(fake.transport);

  for (const bad of [
    'http://localhost:5000/api/track/search',
    'https://f95zone.to/sam/latest_alpha/data.json',
    'https://wsrv.nl/?url=x',
    'https://api.rule34.xxx.evil.test/index.php'
  ]) {
    await assert.rejects(() => request(bad), err => err instanceof NetworkError && err.kind === 'denied');
  }
  assert.equal(fake.calls.length, 0, 'no denied request may reach a transport');
});

test('a json body is parsed and the transport is called once', async () => {
  const fake = fakeTransport(() => ({ status: 200, body: '[{"id":1}]' }));
  setTransport(fake.transport);
  assert.deepEqual(await request(URL_OK), [{ id: 1 }]);
  assert.equal(fake.calls.length, 1, 'no retry storm');
  assert.equal(fake.calls[0].options.timeoutMs, DEFAULT_TIMEOUT_MS);
});

test('text format returns the raw body', async () => {
  setTransport(fakeTransport(() => ({ status: 200, body: '<posts count="7" />' })).transport);
  assert.equal(await request(URL_OK, { format: 'text' }), '<posts count="7" />');
});

test('http status codes map to actionable kinds', async () => {
  const expected = [[401, 'auth'], [403, 'auth'], [429, 'throttled'], [500, 'server'], [503, 'unavailable'], [404, 'http']];
  for (const [status, kind] of expected) {
    setTransport(fakeTransport(() => ({ status, body: '' })).transport);
    await assert.rejects(() => request(URL_OK), err => err.kind === kind, `status ${status} should be ${kind}`);
  }
});

test('a 200 that is actually a block page is not treated as data', async () => {
  setTransport(fakeTransport(() => ({ status: 200, body: '<!DOCTYPE html><html>Just a moment...</html>' })).transport);
  await assert.rejects(() => request(URL_OK), err => err.kind === 'blocked');
});

test('an unparseable json body is a format failure, not empty results', async () => {
  setTransport(fakeTransport(() => ({ status: 200, body: '{oops' })).transport);
  await assert.rejects(() => request(URL_OK), err => err.kind === 'invalid-format');
});

test('a transport failure never leaks the url or the credentials in it', async () => {
  setTransport(fakeTransport(() => {
    throw new Error(`connect failed for https://api.rule34.xxx/index.php?api_key=${SECRET}`);
  }).transport);

  await assert.rejects(
    () => request(`${URL_OK}&api_key=${SECRET}`),
    err => {
      assert.equal(err.kind, 'offline');
      assert.ok(!err.message.includes(SECRET), 'the key must not appear in the message');
      assert.ok(!err.message.includes('api.rule34.xxx'), 'the url must not appear in the message');
      return true;
    }
  );
});

test('an already aborted signal is refused without dispatching', async () => {
  const fake = fakeTransport(() => ({ status: 200, body: '[]' }));
  setTransport(fake.transport);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => request(URL_OK, { signal: controller.signal }), err => err.kind === 'aborted');
  assert.equal(fake.calls.length, 0);
});

test('aborting mid-flight settles the caller at once and ignores the late result', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  setTransport(fakeTransport(async () => {
    await pending;
    return { status: 200, body: '[{"id":1}]' };
  }).transport);

  const controller = new AbortController();
  const promise = request(URL_OK, { signal: controller.signal });
  controller.abort();

  await assert.rejects(() => promise, err => err.kind === 'aborted');

  // The native request cannot really be cancelled; letting it finish must not
  // throw an unhandled rejection or re-settle the caller.
  release();
  await pending;
  await new Promise(resolve => setImmediate(resolve));
});

test('a slow transport hits the deadline and cleans up its timer', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  setTransport(fakeTransport(async () => {
    await pending;
    return { status: 200, body: '[]' };
  }).transport);

  const started = Date.now();
  await assert.rejects(() => request(URL_OK, { timeoutMs: 20 }), err => err.kind === 'timeout');
  assert.ok(Date.now() - started < 2000, 'the caller settles on the deadline, not on the transport');

  release();
  await pending;
  // If the timeout timer were still pending the process would stay alive; the
  // test runner exiting cleanly is the assertion.
});

test('a late success after a timeout does not resolve the caller twice', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  setTransport(fakeTransport(async () => {
    await pending;
    return { status: 200, body: '[{"id":"late"}]' };
  }).transport);

  let settled = 0;
  const promise = request(URL_OK, { timeoutMs: 10 }).then(() => { settled++; }, () => { settled++; });
  await promise;
  release();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(settled, 1);
});

test('the browser transport is only a development preview, never a native fallback', async () => {
  // A failing native transport must surface the failure rather than silently
  // retrying through fetch, which would defeat the whole point of native HTTP.
  const fake = fakeTransport(() => { throw new Error('native boom'); }, 'native');
  setTransport(fake.transport);
  await assert.rejects(() => request(URL_OK), err => err.kind === 'offline');
  assert.equal(fake.calls.length, 1, 'exactly one attempt, no fallback transport');
});

test('platform detection defaults to the browser transport off-device', async () => {
  resetTransport();
  assert.equal(isNative(), false);
  const transport = await getTransport();
  assert.equal(transport.kind, 'browser');
});

test('describeError offers retry and settings where they make sense', () => {
  assert.deepEqual(
    describeError(new NetworkError('auth', 'x', 401)),
    { kind: 'auth', message: 'Your account details for this source were rejected.', canRetry: false, needsSettings: true }
  );
  assert.equal(describeError(new NetworkError('timeout', 'x')).canRetry, true);
  assert.equal(describeError(new NetworkError('throttled', 'x')).canRetry, true);
  assert.equal(describeError(new NetworkError('denied', 'x')).canRetry, false);
  assert.equal(describeError(new Error('plain')).kind, 'unknown');
  assert.ok(describeError({ kind: 'unsupported-source' }).message.includes('not available'));
});
