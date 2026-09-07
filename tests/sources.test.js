import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCES, isSource, assertSource, postKey, splitKey, buildPostsUrl, buildCountUrl,
  buildAutocompleteUrl, buildTagCategoryUrl, buildPostLink, safeMediaUrl, isApiUrl,
  normalizePost, mediaKind, videoMimeType, SourceError
} from '../src/sources.js';

const CREDS = { uid: '12345', key: 'test-key-not-real' };

test('only rule34 and gelbooru are sources', () => {
  assert.deepEqual(Object.keys(SOURCES).sort(), ['gel', 'r34']);
  for (const bad of ['f95', 'lewd', 'local', 'game_vault', '__proto__', 'constructor', '', 'R34', null, undefined, 0]) {
    assert.equal(isSource(bad), false, `${String(bad)} must not be a source`);
    assert.throws(() => assertSource(bad), SourceError);
  }
});

test('post keys are source-qualified so equal ids do not collide', () => {
  assert.notEqual(postKey('r34', '42'), postKey('gel', '42'));
  assert.equal(postKey('r34', 42), 'r34:42');
  assert.deepEqual(splitKey('gel:42'), { source: 'gel', id: '42' });
  assert.equal(splitKey('f95:42'), null);
  assert.equal(splitKey('42'), null);
  assert.equal(splitKey('r34:'), null);
  assert.throws(() => postKey('r34', ''), SourceError);
  assert.throws(() => postKey('r34', null), SourceError);
});

test('post urls use zero-based pid and encode tags exactly once', () => {
  const url = new URL(buildPostsUrl('r34', { query: 'cat dog', page: 0 }));
  assert.equal(url.origin, 'https://api.rule34.xxx');
  assert.equal(url.searchParams.get('pid'), '0');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(url.searchParams.get('tags'), 'cat dog');
  assert.equal(url.searchParams.get('json'), '1');
  assert.ok(url.href.includes('tags=cat+dog'), 'spaces are encoded once, as +');
});

test('tags containing url-significant characters survive a round trip', () => {
  for (const tag of ['a&b', 'a+b', 'a#b', 'ω_tag', 'artist:someone', '100%_wool']) {
    const url = new URL(buildPostsUrl('gel', { query: tag, page: 3 }));
    assert.equal(url.searchParams.get('tags'), tag);
    assert.equal(url.searchParams.get('pid'), '3');
  }
});

test('sorts match each source and rule34 defaults to all', () => {
  assert.equal(new URL(buildPostsUrl('r34', {})).searchParams.get('tags'), 'all');
  assert.equal(new URL(buildPostsUrl('gel', {})).searchParams.get('tags'), '');
  assert.equal(new URL(buildPostsUrl('r34', { sort: 'top' })).searchParams.get('tags'), 'sort:score:desc');
  assert.equal(new URL(buildPostsUrl('gel', { query: 'cat', sort: 'top' })).searchParams.get('tags'), 'cat sort:score');
  for (const source of ['r34', 'gel']) {
    assert.match(new URL(buildPostsUrl(source, { query: 'cat', sort: 'old' })).searchParams.get('tags'), /sort:id:asc$/);
  }
});

test('credentials attach only as a complete pair, and only to their own source', () => {
  const withBoth = new URL(buildPostsUrl('gel', {}, CREDS));
  assert.equal(withBoth.searchParams.get('user_id'), CREDS.uid);
  assert.equal(withBoth.searchParams.get('api_key'), CREDS.key);

  for (const partial of [{ uid: '1', key: '' }, { uid: '', key: 'k' }, {}, null, undefined]) {
    const url = new URL(buildPostsUrl('gel', {}, partial));
    assert.equal(url.searchParams.get('user_id'), null);
    assert.equal(url.searchParams.get('api_key'), null);
  }
});

test('credentials with reserved characters are encoded, not injected', () => {
  const url = new URL(buildPostsUrl('r34', {}, { uid: '1&x=2', key: 'a b/c?d' }));
  assert.equal(url.searchParams.get('user_id'), '1&x=2');
  assert.equal(url.searchParams.get('api_key'), 'a b/c?d');
  assert.equal(url.searchParams.get('x'), null, 'an injected parameter must not appear');
});

test('rejects an unsupported source or a negative page at every builder', () => {
  assert.throws(() => buildPostsUrl('f95', {}), SourceError);
  assert.throws(() => buildPostsUrl('r34', { page: -1 }), SourceError);
  assert.throws(() => buildPostsUrl('r34', { page: 1.5 }), SourceError);
  assert.throws(() => buildAutocompleteUrl('lewd', 'x'), SourceError);
  assert.throws(() => buildAutocompleteUrl('r34', '  '), SourceError);
  assert.throws(() => buildCountUrl('gel', 'x'), SourceError, 'gelbooru has no XML count endpoint');
  assert.throws(() => buildPostLink('local', '1'), SourceError);
});

test('metadata endpoints match each source', () => {
  assert.equal(buildAutocompleteUrl('r34', 'cat'), 'https://api.rule34.xxx/autocomplete.php?q=cat');
  const gel = new URL(buildAutocompleteUrl('gel', 'cat'));
  assert.equal(gel.searchParams.get('page'), 'autocomplete2');
  assert.equal(gel.searchParams.get('term'), 'cat');
  assert.equal(gel.searchParams.get('type'), 'tag_query');
  assert.equal(gel.searchParams.get('limit'), '25');

  const count = new URL(buildCountUrl('r34', 'cat'));
  assert.equal(count.searchParams.get('limit'), '0');
  assert.equal(count.searchParams.get('pid'), '0');

  const tag = new URL(buildTagCategoryUrl('r34', 'cat'));
  assert.equal(tag.searchParams.get('s'), 'tag');
  assert.equal(tag.searchParams.get('name'), 'cat');
});

test('post links point at each source site with its own id', () => {
  assert.equal(buildPostLink('r34', '42'), 'https://rule34.xxx/index.php?page=post&s=view&id=42');
  assert.equal(buildPostLink('gel', '42'), 'https://gelbooru.com/index.php?page=post&s=view&id=42');
});

test('only the two api origins are recognised', () => {
  assert.ok(isApiUrl('https://api.rule34.xxx/index.php?x=1'));
  assert.ok(isApiUrl('https://gelbooru.com/index.php'));
  for (const bad of [
    'http://api.rule34.xxx/index.php',
    'https://api.rule34.xxx.evil.test/index.php',
    'http://localhost:5000/api/category/',
    'https://f95zone.to/sam/latest_alpha/data.json',
    'https://wsrv.nl/?url=x',
    'not a url'
  ]) {
    assert.equal(isApiUrl(bad), false, `${bad} must not be an API origin`);
  }
});

test('media urls are restricted to the source domain families', () => {
  assert.equal(safeMediaUrl('//wimg.rule34.xxx/images/1/a.jpg'), 'https://wimg.rule34.xxx/images/1/a.jpg');
  assert.equal(safeMediaUrl('https://img3.gelbooru.com/images/a.png'), 'https://img3.gelbooru.com/images/a.png');
  assert.equal(safeMediaUrl('https://rule34.xxx/a.jpg'), 'https://rule34.xxx/a.jpg');

  for (const bad of [
    'https://gelbooru.com.attacker.test/a.jpg',
    'https://notgelbooru.com/a.jpg',
    'http://wimg.rule34.xxx/a.jpg',
    'https://user:pass@wimg.rule34.xxx/a.jpg',
    'https://wimg.rule34.xxx:8443/a.jpg',
    'javascript:alert(1)',
    'data:text/html,<script>x</script>',
    'file:///etc/passwd',
    'https://127.0.0.1/a.jpg',
    ''
  ]) {
    assert.equal(safeMediaUrl(bad), '', `${bad} must be rejected`);
  }
});

test('media kind and mime type follow the actual extension', () => {
  assert.equal(mediaKind('https://x.rule34.xxx/a.mp4'), 'video');
  assert.equal(mediaKind('https://x.rule34.xxx/a.webm?1'), 'video');
  assert.equal(mediaKind('https://x.rule34.xxx/a.gif'), 'gif');
  assert.equal(mediaKind('https://x.rule34.xxx/a.png'), 'image');
  assert.equal(videoMimeType('https://x.rule34.xxx/a.webm'), 'video/webm');
  assert.equal(videoMimeType('https://x.rule34.xxx/a.mp4'), 'video/mp4');
  assert.equal(videoMimeType('https://x.rule34.xxx/a.png'), '');
});

test('normalizePost carries the source and drops posts with no usable media', () => {
  const post = normalizePost('gel', {
    id: 42,
    file_url: '//img3.gelbooru.com/images/a.mp4',
    preview_url: 'https://img3.gelbooru.com/thumbs/a.jpg',
    tags: 'cat dog',
    width: '100',
    score: '7'
  });
  assert.equal(post.source, 'gel');
  assert.equal(post.key, 'gel:42');
  assert.equal(post.id, '42');
  assert.equal(post.file_url, 'https://img3.gelbooru.com/images/a.mp4');
  assert.equal(post.kind, 'video');
  assert.equal(post.width, 100);
  assert.equal(post.score, 7);

  assert.equal(normalizePost('r34', { id: 1, file_url: 'https://evil.test/a.jpg' }), null);
  assert.equal(normalizePost('r34', { file_url: 'https://rule34.xxx/a.jpg' }), null);
  assert.equal(normalizePost('r34', null), null);
});
