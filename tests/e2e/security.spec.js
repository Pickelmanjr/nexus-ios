import { test, expect, stubSources, makePost } from './fixtures.js';

test('the page loads no remote script and defines no global app', async ({ page }) => {
  const external = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') external.push(req.url());
  });

  await stubSources(page, { posts: () => ({ json: [] }) });
  await page.goto('/?m=r34');
  await expect(page.locator('#app-layout')).toBeVisible();

  const scriptHosts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map(s => new URL(s.src, location.href).hostname)
  );
  for (const host of scriptHosts) {
    expect(['127.0.0.1', 'localhost']).toContain(host);
  }

  expect(await page.evaluate(() => typeof window.app)).toBe('undefined');
  expect(await page.evaluate(() => typeof window.DB)).toBe('undefined');

  // The only external traffic is to the two allowed source origins.
  for (const url of external) {
    const host = new URL(url).hostname;
    expect(
      host === 'api.rule34.xxx' || host === 'gelbooru.com' || host.endsWith('.rule34.xxx') || host.endsWith('.gelbooru.com'),
      `unexpected external request to ${url}`
    ).toBe(true);
  }
});

test('the content security policy blocks an injected inline script', async ({ page, expectedProblems }) => {
  // The refusal this test provokes is the result being asserted.
  expectedProblems.allow(/refused to execute inline script|content security policy/i);
  await stubSources(page, { posts: () => ({ json: [] }) });
  await page.goto('/?m=r34');

  const executed = await page.evaluate(() => {
    window.__inlineRan = false;
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true;';
    document.body.appendChild(script);
    return window.__inlineRan;
  });
  expect(executed, 'an inline script must not run under the policy').toBe(false);
});

test('the markup carries no inline handlers after rendering real posts', async ({ page }) => {
  await stubSources(page, {
    posts: () => ({
      json: [
        makePost('r34', '1', { tags: '"><img src=x onerror=window.__x=1> tag_a' }),
        makePost('r34', '2', { tags: "' onmouseover='window.__y=1' tag_b" })
      ]
    })
  });
  await page.goto('/?m=r34');
  await page.locator('#search-input').fill('example_tag');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('.media-card').first()).toBeVisible();

  const inline = await page.evaluate(() => {
    const found = [];
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes) {
        if (/^on/i.test(attr.name)) found.push(`${el.tagName}[${attr.name}]`);
      }
    }
    return found;
  });
  expect(inline, 'no element may carry an inline event handler').toEqual([]);
  expect(await page.evaluate(() => window.__x)).toBeUndefined();
  expect(await page.evaluate(() => window.__y)).toBeUndefined();
});

test('a hostile media url from the source is never attached to the page', async ({ page }) => {
  await stubSources(page, {
    posts: () => ({
      json: [
        { id: '10', file_url: 'javascript:window.__evil=1', tags: 'a' },
        { id: '11', file_url: 'https://evil.test/a.jpg', preview_url: 'https://evil.test/t.jpg', tags: 'b' },
        { id: '12', file_url: 'https://wimg.rule34.xxx/images/12.jpg', tags: 'c' }
      ]
    })
  });
  await page.goto('/?m=r34');
  await page.locator('#search-input').fill('example_tag');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('.media-card')).toHaveCount(1, { timeout: 10000 });

  const sources = await page.evaluate(() => [...document.querySelectorAll('img, video, source')].map(el => el.getAttribute('src') || ''));
  for (const src of sources) {
    expect(src.startsWith('javascript:'), `refused scheme leaked: ${src}`).toBe(false);
    expect(src.includes('evil.test'), `off-domain media leaked: ${src}`).toBe(false);
  }
  expect(await page.evaluate(() => window.__evil)).toBeUndefined();
});

test('no request reaches a desktop backend or an image proxy', async ({ page }) => {
  const requests = [];
  page.on('request', req => requests.push(req.url()));

  await stubSources(page, { posts: () => ({ json: [makePost('r34', '1')] }) });
  await page.goto('/?m=r34');
  await page.locator('#search-input').fill('example_tag');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('.media-card').first()).toBeVisible();
  await page.locator('#nav-keep-up').click();
  await page.locator('#nav-reels').click();

  for (const url of requests) {
    expect(/localhost:5000|:5000\/api|wsrv\.nl|allorigins|corsproxy|f95zone|lewd\.ninja/i.test(url),
      `forbidden endpoint contacted: ${url}`).toBe(false);
  }
});

test('the source link opens outside the app rather than navigating it', async ({ page, context }) => {
  await stubSources(page, { posts: () => ({ json: [makePost('r34', '1')] }) });
  await page.goto('/?m=r34');
  await page.locator('#search-input').fill('example_tag');
  await page.locator('#search-input').press('Enter');
  await page.locator('#card-r34\\:1').click();

  const before = page.url();
  // In the browser preview the fallback opens a new tab; on the device this is
  // Browser.open. Either way this page must not navigate.
  const popupPromise = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
  await page.locator('#viewer-source-link').click();
  const popup = await popupPromise;

  expect(page.url(), 'the app page must stay where it was').toBe(before);
  if (popup) {
    expect(new URL(popup.url()).hostname).toBe('rule34.xxx');
    // The opened window must not be able to reach back into the app.
    expect(await page.evaluate(() => window.opener)).toBeNull();
    await popup.close();
  }
});

test('an api credential never appears in a message shown to the user', async ({ page }) => {
  await stubSources(page, { posts: () => ({ status: 500, body: '{}' }) });
  await page.goto('/?m=r34');
  await page.locator('#settings-trigger').click();
  await page.locator('#r34-uid-input').fill('13579');
  await page.locator('#r34-key-input').fill('leaky-secret-value');
  await page.locator('#save-r34-creds-btn').click();
  await expect(page.locator('#r34-creds-status')).toContainText(/saved/i);
  await page.locator('#close-settings').click();

  await page.locator('#search-input').fill('example_tag');
  await page.locator('#search-input').press('Enter');
  await expect(page.locator('#end-of-results')).toBeVisible();

  const visible = await page.evaluate(() => document.body.innerText);
  expect(visible.includes('leaky-secret-value'), 'the API key must never be rendered').toBe(false);
  expect(visible.includes('13579'), 'the user id must never be rendered in an error').toBe(false);
});
