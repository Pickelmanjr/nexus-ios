import { test as base, expect } from '@playwright/test';

// Every source endpoint is stubbed. No test contacts Rule34 or Gelbooru, and no
// test uses a real account, so nothing here depends on private credentials or
// on adult content being fetched.

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export const R34_HOST = 'https://api.rule34.xxx';
export const GEL_HOST = 'https://gelbooru.com';

export function makePost(source, id, overrides = {}) {
  const host = source === 'r34' ? 'https://wimg.rule34.xxx' : 'https://img3.gelbooru.com';
  return {
    id,
    file_url: `${host}/images/${id}.jpg`,
    sample_url: `${host}/samples/${id}.jpg`,
    preview_url: `${host}/thumbnails/${id}.jpg`,
    tags: `example_tag tag_${id}`,
    width: 800,
    height: 1200,
    score: Number(id),
    rating: 'safe',
    ...overrides
  };
}

export function gelEnvelope(posts, count = posts.length) {
  return { '@attributes': { limit: 20, offset: 0, count }, post: posts };
}

/**
 * Install source stubs. `handlers` may override any of:
 *   posts(url) -> { status?, body?, json? }
 *   autocomplete(url), count(url), tags(url)
 */
export async function stubSources(page, handlers = {}) {
  const calls = [];

  const respond = async (route, result) => {
    if (result && result.abort) return route.abort('failed');
    const status = (result && result.status) || 200;
    const body = result && result.body !== undefined
      ? result.body
      : JSON.stringify((result && result.json) !== undefined ? result.json : []);
    await route.fulfill({
      status,
      contentType: (result && result.contentType) || 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body
    });
  };

  await page.route(/https:\/\/(api\.rule34\.xxx|gelbooru\.com)\/.*/, async (route) => {
    const url = new URL(route.request().url());
    calls.push(url.href);

    const source = url.hostname.includes('rule34') ? 'r34' : 'gel';
    const isAutocomplete = url.pathname.includes('autocomplete') || url.searchParams.get('page') === 'autocomplete2';
    const isTagLookup = url.searchParams.get('s') === 'tag';
    const isCount = url.searchParams.get('limit') === '0';

    if (isAutocomplete) return respond(route, await call(handlers.autocomplete, url, source));
    if (isTagLookup) return respond(route, await call(handlers.tags, url, source, { contentType: 'text/xml', body: '<tags></tags>' }));
    if (isCount) return respond(route, await call(handlers.count, url, source, { contentType: 'text/xml', body: '<posts count="1234" />' }));
    return respond(route, await call(handlers.posts, url, source, { json: [] }));
  });

  // Thumbnails and media resolve to a 1x1 png so nothing is fetched for real.
  await page.route(/https:\/\/([\w.-]+\.)?(rule34\.xxx|gelbooru\.com)\/(images|samples|thumbnails)\/.*/, route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX })
  );

  return calls;
}

async function call(handler, url, source, fallback = {}) {
  if (typeof handler === 'function') {
    const result = await handler(url, source);
    if (result !== undefined) return result;
  }
  return fallback;
}

/**
 * Fails the test if the page logs an uncaught error or a CSP violation.
 *
 * A test that deliberately provokes one declares it with
 * `expectedProblems.allow(/pattern/)`, so the guard stays on everywhere else.
 */
export const test = base.extend({
  expectedProblems: async ({}, use) => {
    const allowed = [];
    await use({ allow: pattern => allowed.push(pattern), patterns: allowed });
  },
  page: async ({ page, expectedProblems }, use) => {
    const problems = [];
    page.on('pageerror', err => problems.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
      const text = msg.text();
      if (msg.type() === 'error' && /content security policy|refused to/i.test(text)) {
        problems.push(`csp: ${text}`);
      }
    });
    await use(page);
    const unexpected = problems.filter(p => !expectedProblems.patterns.some(rx => rx.test(p)));
    expect(unexpected, 'the page must not raise uncaught errors or CSP violations').toEqual([]);
  }
});

export { expect };
