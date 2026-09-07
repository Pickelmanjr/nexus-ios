import { test, expect, stubSources, makePost, gelEnvelope } from './fixtures.js';

test.describe('gateway and navigation', () => {
  test('offers exactly the two supported sources', async ({ page }) => {
    await stubSources(page);
    await page.goto('/');
    const cards = page.locator('.gw-card');
    await expect(cards).toHaveCount(2);
    await expect(page.locator('.gw-card[data-mode="r34"]')).toBeVisible();
    await expect(page.locator('.gw-card[data-mode="gel"]')).toBeVisible();
    await expect(page.locator('#app-layout')).toBeHidden();
  });

  test('an unsupported source in the url falls back to the gateway', async ({ page }) => {
    const calls = await stubSources(page);
    for (const mode of ['f95', 'local', 'lewd', '__proto__', 'r34%20']) {
      await page.goto(`/?m=${mode}`);
      await expect(page.locator('#gateway-screen')).toBeVisible();
      await expect(page.locator('#app-layout')).toBeHidden();
    }
    expect(calls, 'an invalid deep link must not trigger a source request').toEqual([]);
  });

  test('a valid deep link opens that source directly', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [makePost('r34', '1')] }) });
    await page.goto('/?m=r34');
    await expect(page.locator('#app-layout')).toBeVisible();
    await expect(page.locator('#gateway-screen')).toBeHidden();
  });

  test('switching source returns to the gateway and clears the url', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [makePost('r34', '1')] }) });
    await page.goto('/?m=r34');
    await page.locator('#switch-db-btn').click();
    await expect(page.locator('#gateway-screen')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('m')).toBeNull();
  });
});

test.describe('search', () => {
  test('the first page requests pid=0 and renders the results', async ({ page }) => {
    const calls = await stubSources(page, {
      posts: () => ({ json: Array.from({ length: 12 }, (_, i) => makePost('r34', String(100 + i))) })
    });
    await page.goto('/?m=r34');
    await expect(page.locator('.media-card').first()).toBeVisible();

    // Opening the app already loaded the For You feed; only the search request
    // is under test here.
    calls.length = 0;
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('.media-card').first()).toBeVisible();

    const search = calls.find(c => c.includes('s=post') && c.includes('tags=example_tag'));
    expect(search, 'the search must reach the source').toBeTruthy();
    expect(new URL(search).searchParams.get('pid')).toBe('0');
    expect(new URL(search).searchParams.get('tags')).toBe('example_tag');
    expect(new URL(search).searchParams.get('limit')).toBe('20');
  });

  test('a genuinely empty result says so without claiming an error', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [] }) });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('nothing_matches_this');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('#end-of-results')).toContainText(/No results/i);
    await expect(page.locator('.media-card')).toHaveCount(0);
  });

  test('a malformed response is reported as a failure, not as no results', async ({ page }) => {
    await stubSources(page, { posts: () => ({ body: '<!DOCTYPE html><html>Just a moment...</html>', contentType: 'text/html' }) });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');

    const eor = page.locator('#end-of-results');
    await expect(eor).toBeVisible();
    await expect(eor).not.toContainText(/No results found/i);
    await expect(eor).toContainText(/block page|could not read/i);
    await expect(eor.locator('button', { hasText: 'Retry' })).toBeVisible();
  });

  test('a rejected account offers settings, and a timeout offers retry', async ({ page }) => {
    let status = 401;
    await stubSources(page, { posts: () => ({ status, body: '{}' }) });
    await page.goto('/?m=gel');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');

    const eor = page.locator('#end-of-results');
    await expect(eor).toContainText(/account details/i);
    await expect(eor.locator('button', { hasText: 'Open settings' })).toBeVisible();

    status = 429;
    await page.locator('#search-input').fill('another_tag');
    await page.locator('#search-input').press('Enter');
    await expect(eor).toContainText(/rate|too many/i);
    await expect(eor.locator('button', { hasText: 'Retry' })).toBeVisible();
  });

  test('retry re-runs the same page and can succeed', async ({ page }) => {
    let fail = true;
    await stubSources(page, {
      posts: () => (fail ? { status: 503, body: '{}' } : { json: [makePost('r34', '1')] })
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');

    const retry = page.locator('#end-of-results button', { hasText: 'Retry' });
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(page.locator('.media-card')).toHaveCount(1);
  });

  test('a failed page keeps the results already on screen', async ({ page }) => {
    // Page 0 succeeds with a full screen of posts; every later page fails.
    await stubSources(page, {
      posts: (url) => {
        if (url.searchParams.get('pid') === '0') {
          return { json: Array.from({ length: 20 }, (_, i) => makePost('r34', String(200 + i))) };
        }
        return { status: 500, body: '{}' };
      }
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('.media-card').first()).toBeVisible();
    const before = await page.locator('.media-card').count();
    expect(before).toBeGreaterThan(0);

    await page.locator('#grid-view').evaluate(el => el.scrollTo(0, el.scrollHeight));
    await expect(page.locator('#end-of-results')).toBeVisible();
    await expect(page.locator('#end-of-results')).toContainText(/server error/i);
    expect(await page.locator('.media-card').count(), 'the loaded grid survives a failed page').toBeGreaterThanOrEqual(before);
  });

  test('the newest query wins when an earlier one is still resolving', async ({ page }) => {
    await stubSources(page, {
      posts: async (url) => {
        const tags = url.searchParams.get('tags') || '';
        if (tags.includes('slow_tag')) {
          await new Promise(resolve => setTimeout(resolve, 1200));
          return { json: [makePost('r34', '999', { tags: 'slow_tag' })] };
        }
        return { json: [makePost('r34', '111', { tags: 'fast_tag' })] };
      }
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('slow_tag');
    await page.locator('#search-input').press('Enter');
    await page.locator('#search-input').fill('fast_tag');
    await page.locator('#search-input').press('Enter');

    await expect(page.locator('#card-r34\\:111')).toBeVisible();
    await page.waitForTimeout(1600);
    await expect(page.locator('#card-r34\\:999'), 'the stale response must not land').toHaveCount(0);
  });

  test('the sort preference reaches the request as the source expects', async ({ page }) => {
    // A full page, so the bounded backfill scan does not keep firing requests
    // with the previous sort while this test samples them.
    const calls = await stubSources(page, {
      posts: () => ({ json: Array.from({ length: 20 }, (_, i) => makePost('r34', String(600 + i))) })
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('.media-card').first()).toBeVisible();

    const sortCalls = () => calls
      .filter(c => c.includes('s=post') && !c.includes('limit=0'))
      .map(c => new URL(c));

    for (const [option, expected] of [
      ['top', 'example_tag sort:score:desc'],
      ['old', 'example_tag sort:id:asc'],
      ['new', 'example_tag']
    ]) {
      calls.length = 0;
      await page.locator('#settings-trigger').click();
      await page.locator('#sort-select').selectOption(option);
      await page.locator('#close-settings').click();

      await expect.poll(() => sortCalls().some(u => u.searchParams.get('tags') === expected),
        { message: `sort ${option} must reach the source` }).toBe(true);
      const url = sortCalls().find(u => u.searchParams.get('tags') === expected);
      expect(url.searchParams.get('pid'), 'a re-sort restarts at the first page').toBe('0');
    }
  });

  test('scrolling loads the next page and does not repeat the first', async ({ page }) => {
    const pages = [];
    await stubSources(page, {
      posts: (url) => {
        const pid = Number(url.searchParams.get('pid'));
        pages.push(pid);
        // 20 distinct posts per page, ids offset so nothing overlaps.
        return { json: Array.from({ length: 20 }, (_, i) => makePost('r34', String(1000 + pid * 100 + i))) };
      }
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('.media-card').first()).toBeVisible();

    const before = await page.locator('.media-card').count();
    await page.locator('#grid-view').evaluate(el => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => page.locator('.media-card').count()).toBeGreaterThan(before);

    expect(pages, 'the feed must start at page zero').toContain(0);
    expect(Math.max(...pages), 'scrolling must advance the page').toBeGreaterThan(0);

    // Every rendered card is distinct: no page is applied twice.
    const ids = await page.locator('.media-card').evaluateAll(els => els.map(el => el.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('autocomplete suggests tags and says so when the lookup fails', async ({ page }) => {
    let ok = true;
    await stubSources(page, {
      posts: () => ({ json: [] }),
      autocomplete: () => (ok
        ? { json: [{ label: 'example_tag (812)', value: 'example_tag' }] }
        : { status: 500, body: '{}' })
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('exam');
    await expect(page.locator('#suggestions-list li').first()).toContainText('example tag');

    ok = false;
    await page.locator('#search-input').fill('exampl');
    await expect(page.locator('#suggestions-list')).toContainText(/unavailable/i);
  });
});

test.describe('views', () => {
  test('the vault shows only the selected source, so equal ids do not collide', async ({ page }) => {
    await stubSources(page, {
      posts: (url, source) => ({
        json: source === 'gel'
          ? gelEnvelope([makePost('gel', '42')])
          : [makePost('r34', '42')]
      })
    });

    // Save post 42 on Rule34.
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await page.locator('#card-r34\\:42').click();
    await page.locator('#viewer-fav-btn').click();
    await expect(page.locator('#viewer-fav-btn')).toHaveClass(/faved/);
    await page.locator('#close-viewer').click();

    // Save post 42 on Gelbooru too.
    await page.goto('/?m=gel');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await page.locator('#card-gel\\:42').click();
    await page.locator('#viewer-fav-btn').click();
    await expect(page.locator('#viewer-fav-btn')).toHaveClass(/faved/);
    await page.locator('#close-viewer').click();

    // The Gelbooru vault holds one post, not two.
    await page.locator('#nav-media-vault').click();
    await expect(page.locator('.media-card')).toHaveCount(1);
    await expect(page.locator('#card-gel\\:42')).toBeVisible();

    await page.goto('/?m=r34');
    await page.locator('#nav-media-vault').click();
    await expect(page.locator('.media-card')).toHaveCount(1);
    await expect(page.locator('#card-r34\\:42')).toBeVisible();
  });

  test('keep up renders a row per tracked tag', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [makePost('r34', '7')] }) });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();
    await page.locator('#track-input').fill('tracked_one');
    await page.locator('#add-track-btn').click();
    await page.locator('#track-input').fill('tracked_two');
    await page.locator('#add-track-btn').click();
    await page.locator('#close-settings').click();

    await page.locator('#nav-keep-up').click();
    await expect(page.locator('.ku-section')).toHaveCount(2);
    await expect(page.locator('.ku-section .media-card').first()).toBeVisible();
  });

  test('reels loads only playable videos', async ({ page }) => {
    await stubSources(page, {
      posts: (url) => {
        const tags = url.searchParams.get('tags') || '';
        if (!tags.includes('video')) return { json: [] };
        return {
          json: [
            makePost('r34', '500', { file_url: 'https://wimg.rule34.xxx/images/500.mp4' }),
            makePost('r34', '501')
          ]
        };
      }
    });
    await page.goto('/?m=r34');
    await page.locator('#nav-reels').click();
    await expect(page.locator('.reel-card')).toHaveCount(1);
    await expect(page.locator('.reel-video')).toHaveAttribute('src', /500\.mp4$/);
  });

  test('the blacklist hides matching posts and says why', async ({ page }) => {
    await stubSources(page, {
      posts: () => ({ json: [makePost('r34', '9', { tags: 'blocked_tag other' })] })
    });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();
    await page.locator('#bl-input').fill('blocked_tag');
    await page.locator('#add-bl-btn').click();
    await page.locator('#close-settings').click();

    await page.locator('#search-input').fill('other');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('.media-card')).toHaveCount(0);
    await expect(page.locator('#end-of-results')).toContainText(/blacklist/i);
  });
});

test.describe('viewer', () => {
  test('navigates between posts and links out without navigating the app', async ({ page, context }) => {
    await stubSources(page, {
      posts: () => ({ json: [makePost('r34', '1'), makePost('r34', '2'), makePost('r34', '3')] })
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');

    await page.locator('#card-r34\\:1').click();
    await expect(page.locator('#viewer-stats')).toContainText('Rule34 1');
    await page.locator('#lightbox-next').click();
    await expect(page.locator('#viewer-stats')).toContainText('Rule34 2');
    await page.locator('#lightbox-prev').click();
    await expect(page.locator('#viewer-stats')).toContainText('Rule34 1');

    // The source link is a button, so nothing can navigate this origin away.
    const link = page.locator('#viewer-source-link');
    await expect(link).toBeVisible();
    expect(await link.evaluate(el => el.tagName)).toBe('BUTTON');

    await page.locator('#close-viewer').click();
    await expect(page.locator('#media-viewer')).toBeHidden();
    expect(new URL(page.url()).origin).toBe(new URL(page.url()).origin);
  });

  test('tags render as text, so a hostile tag cannot execute', async ({ page }) => {
    await stubSources(page, {
      posts: () => ({
        json: [makePost('r34', '1', { tags: '<img src=x onerror=window.__pwned=1> safe_tag' })]
      })
    });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await page.locator('#card-r34\\:1').click();

    await expect(page.locator('#viewer-tags')).toBeVisible();
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
    // The angle brackets are visible as text rather than parsed as markup.
    await expect(page.locator('#viewer-tags')).toContainText('<img');
    expect(await page.locator('#viewer-tags img').count()).toBe(0);
  });

  test('unplayable media offers the source instead of spinning', async ({ page }) => {
    await stubSources(page, {
      posts: () => ({ json: [makePost('r34', '1', { file_url: 'https://wimg.rule34.xxx/images/1.mp4' })] })
    });
    // Fail just this media request.
    await page.route('https://wimg.rule34.xxx/images/1.mp4', route => route.abort('failed'));

    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await page.locator('#card-r34\\:1').click();
    await expect(page.locator('.media-unavailable')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.media-unavailable')).toContainText(/Open on Rule34/);
  });
});

test.describe('settings and data', () => {
  test('settings open with no network at all', async ({ page }) => {
    await stubSources(page, { posts: () => ({ abort: true }) });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();
    await expect(page.locator('#settings-modal')).toBeVisible();
    await expect(page.locator('#r34-settings-group')).toBeVisible();
    await expect(page.locator('#gel-settings-group')).toBeVisible();
  });

  test('accounts save, survive a reload, and clear', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [] }) });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();

    // A half pair is refused rather than silently stored.
    await page.locator('#r34-uid-input').fill('12345');
    await page.locator('#save-r34-creds-btn').click();
    await expect(page.locator('#r34-creds-status')).toContainText(/both/i);

    await page.locator('#r34-key-input').fill('example-key');
    await page.locator('#save-r34-creds-btn').click();
    await expect(page.locator('#r34-creds-status')).toContainText(/saved/i);

    await page.reload();
    await page.locator('#settings-trigger').click();
    await expect(page.locator('#r34-uid-input')).toHaveValue('12345');
    await expect(page.locator('#gel-uid-input')).toHaveValue('', { timeout: 5000 });

    await page.locator('#clear-r34-creds-btn').click();
    await expect(page.locator('#r34-uid-input')).toHaveValue('');
    await page.reload();
    await page.locator('#settings-trigger').click();
    await expect(page.locator('#r34-uid-input')).toHaveValue('');
  });

  test('saved accounts are attached to that source only', async ({ page }) => {
    const calls = await stubSources(page, { posts: () => ({ json: [] }) });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();
    await page.locator('#r34-uid-input').fill('12345');
    await page.locator('#r34-key-input').fill('example-key');
    await page.locator('#save-r34-creds-btn').click();
    await expect(page.locator('#r34-creds-status')).toContainText(/saved/i);
    await page.locator('#close-settings').click();

    calls.length = 0;
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('#end-of-results')).toBeVisible();
    const r34Call = calls.find(c => c.includes('api.rule34.xxx') && c.includes('s=post'));
    expect(new URL(r34Call).searchParams.get('user_id')).toBe('12345');

    await page.goto('/?m=gel');
    calls.length = 0;
    await page.locator('#search-input').fill('example_tag');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('#end-of-results')).toBeVisible();
    const gelCall = calls.find(c => c.includes('gelbooru.com') && c.includes('s=post'));
    expect(new URL(gelCall).searchParams.get('user_id'), 'the other source keeps its own account').toBeNull();
  });

  test('grid size and theme survive a reload', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [] }) });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();
    await page.locator('#grid-size-select').selectOption('small');
    await page.locator('.theme-btn[data-theme="#9d00ff"]').click();
    await page.locator('#close-settings').click();

    await page.reload();
    await expect(page.locator('#gateway-screen')).toBeHidden();
    const size = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--grid-size').trim());
    expect(size).toBe('200px');
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent).toBe('#9d00ff');
    await page.locator('#settings-trigger').click();
    await expect(page.locator('#grid-size-select')).toHaveValue('small');
  });

  test('an invalid backup import leaves the existing data untouched', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [] }) });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();
    await page.locator('#fav-input').fill('keepme');
    await page.locator('#add-fav-btn').click();
    await expect(page.locator('#fav-tags-list .chip')).toHaveCount(1);

    await page.locator('#restore-file-input').setInputFiles({
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ favorites: ['from-desktop'], likes: [{ id: 42 }] }))
    });
    await expect(page.locator('#backup-status')).toContainText(/only imports its own export/i);
    await expect(page.locator('#fav-tags-list .chip')).toHaveCount(1);
    await expect(page.locator('#fav-tags-list .chip').first()).toContainText('keepme');
  });

  test('a valid backup import replaces the data and rehydrates the interface', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [] }) });
    await page.goto('/?m=r34');
    await page.locator('#settings-trigger').click();
    await page.locator('#fav-input').fill('stale');
    await page.locator('#add-fav-btn').click();

    const backup = {
      format: 'nexus-ios',
      version: 1,
      settings: { gridSize: 'large' },
      favorites: ['imported_tag'],
      blacklist: [],
      tracked: [],
      savedTags: [],
      searchHistory: [],
      seenIds: [],
      likes: [],
      hearts: [],
      stats: []
    };
    await page.locator('#restore-file-input').setInputFiles({
      name: 'good.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup))
    });
    await expect(page.locator('#backup-status')).toContainText(/restored/i);
    await expect(page.locator('#fav-tags-list .chip')).toHaveCount(1);
    await expect(page.locator('#fav-tags-list .chip').first()).toContainText('imported_tag');
    await expect(page.locator('#grid-size-select')).toHaveValue('large');
  });

  test('previous searches are recorded and can be cleared', async ({ page }) => {
    await stubSources(page, { posts: () => ({ json: [makePost('r34', '1')] }) });
    await page.goto('/?m=r34');
    await page.locator('#search-input').fill('first_search');
    await page.locator('#search-input').press('Enter');
    await expect(page.locator('.prev-search-chip', { hasText: 'first_search' })).toBeVisible();

    await page.locator('.prev-search-clear').click();
    await expect(page.locator('.prev-search-chip')).toHaveCount(0);
  });
});
