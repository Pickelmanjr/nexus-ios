import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  parsePosts, parseCount, parseCountEnvelope, parseAutocomplete, parseTagCategory,
  tagCategoryFromType, SourceError
} from '../src/sources.js';

const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('rule34 arrays parse, and offsite media is dropped rather than rendered', () => {
  const posts = parsePosts('r34', JSON.parse(fixture('r34-posts.json')));
  assert.equal(posts.length, 2, 'the post hosted off the source domain is dropped');
  assert.deepEqual(posts.map(p => p.key), ['r34:1001', 'r34:1002']);
  assert.equal(posts[0].file_url, 'https://wimg.rule34.xxx/samples/1/sample_a.jpg');
  assert.equal(posts[1].kind, 'video');
});

test('a serialized json body parses the same as a parsed one', () => {
  const fromText = parsePosts('r34', fixture('r34-posts.json'));
  const fromObject = parsePosts('r34', JSON.parse(fixture('r34-posts.json')));
  assert.deepEqual(fromText, fromObject);
});

test('the gelbooru envelope parses and reports its count', () => {
  const raw = JSON.parse(fixture('gel-posts.json'));
  const posts = parsePosts('gel', raw);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].key, 'gel:2001');
  assert.equal(parseCountEnvelope(raw), 137);
});

test('valid empty results are success, not failure', () => {
  assert.deepEqual(parsePosts('r34', []), []);
  assert.deepEqual(parsePosts('gel', []), []);
  assert.deepEqual(parsePosts('gel', { post: [] }), []);
  assert.deepEqual(parsePosts('gel', fixture('gel-empty.json')), [], 'explicit zero count means no results');
  assert.equal(parseCountEnvelope(JSON.parse(fixture('gel-empty.json'))), 0);
});

test('an envelope with no posts and no count is a failure, not zero results', () => {
  assert.throws(() => parsePosts('gel', fixture('gel-unknown-envelope.json')), SourceError);
});

test('malformed and hostile bodies throw instead of becoming an empty page', () => {
  const cases = [
    ['not json at all', 'invalid-format'],
    ['<!DOCTYPE html><html><body>Just a moment...</body></html>', 'blocked'],
    ['<html><head><title>Cloudflare</title></head></html>', 'blocked'],
    ['{"success":false,"message":"Missing authentication"}', 'auth'],
    ['{"success":false,"message":"Search error: something broke"}', 'source-error'],
    ['{"unexpected":"shape"}', 'invalid-format'],
    ['42', 'invalid-format'],
    ['"a string body"', 'invalid-format']
  ];
  for (const [body, kind] of cases) {
    let thrown = null;
    try {
      parsePosts('r34', body);
    } catch (e) {
      thrown = e;
    }
    assert.ok(thrown instanceof SourceError, `body ${body} must throw a SourceError`);
    assert.equal(thrown.kind, kind, `body ${body} should classify as ${kind}`);
  }
});

test('an empty body is treated as an empty result set', () => {
  assert.deepEqual(parsePosts('r34', '   '), []);
});

test('rule34 count is read out of the xml attribute', () => {
  assert.equal(parseCount(fixture('r34-count.xml')), 4211);
  assert.equal(parseCount('<posts offset="0" />'), null);
  assert.equal(parseCount(''), null);
  assert.equal(parseCount(null), null);
});

test('autocomplete normalizes both source shapes', () => {
  const gel = parseAutocomplete('gel', fixture('gel-autocomplete.json'));
  assert.deepEqual(gel.map(i => i.name), ['example_tag', 'example_series']);
  assert.equal(gel[0].count, '812');
  assert.equal(gel[1].category, 'copyright');

  const r34 = parseAutocomplete('r34', '[{"label":"example_tag (812)","value":"example_tag"}]');
  assert.equal(r34[0].name, 'example_tag');
  assert.equal(r34[0].count, '812');

  assert.throws(() => parseAutocomplete('r34', '{"nope":1}'), SourceError);
});

test('gelbooru tag categories come from the autocomplete category field', () => {
  assert.equal(parseTagCategory('gel', fixture('gel-autocomplete.json'), 'example_series'), 'Copyright');
  assert.equal(parseTagCategory('gel', fixture('gel-autocomplete.json'), 'unknown_tag'), null);
});

test('rule34 xml tag categories need a DOM parser, and say so by returning null', () => {
  // DOMParser only exists in the web view. Under Node the metadata is simply
  // unavailable; the browser suite covers the parsing path.
  const result = parseTagCategory('r34', fixture('r34-tags.xml'), 'example_series');
  assert.equal(result, typeof DOMParser === 'undefined' ? null : 'Copyright');
});

test('tag type codes map to the display categories', () => {
  assert.equal(tagCategoryFromType('3'), 'Copyright');
  assert.equal(tagCategoryFromType('copyright'), 'Copyright');
  assert.equal(tagCategoryFromType('4'), 'Character');
  assert.equal(tagCategoryFromType('1'), 'Artist');
  assert.equal(tagCategoryFromType('5'), 'Meta');
  assert.equal(tagCategoryFromType('0'), 'General');
  assert.equal(tagCategoryFromType(undefined), 'General');
});
