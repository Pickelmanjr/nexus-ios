import { test, expect, stubSources, makePost } from './fixtures.js';

const SIZES = [
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone SE 1st gen', width: 320, height: 568 }
];

async function horizontalOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}x${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('the gateway fits without sideways scrolling', async ({ page }) => {
      await stubSources(page);
      await page.goto('/');
      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth, 'the document must not scroll sideways').toBeLessThanOrEqual(clientWidth + 1);

      for (const card of await page.locator('.gw-card').all()) {
        const box = await card.boundingBox();
        expect(box.height, 'a source card must be comfortably tappable').toBeGreaterThanOrEqual(44);
      }
    });

    test('the grid fits and the tab bar stays reachable', async ({ page }) => {
      await stubSources(page, {
        posts: () => ({ json: Array.from({ length: 12 }, (_, i) => makePost('r34', String(300 + i))) })
      });
      await page.goto('/?m=r34');
      await expect(page.locator('.media-card').first()).toBeVisible();

      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

      const cards = await page.locator('.media-card').all();
      for (const card of cards.slice(0, 4)) {
        const box = await card.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(-1);
        expect(box.x + box.width, 'no card may hang off the right edge').toBeLessThanOrEqual(clientWidth + 1);
      }

      for (const id of ['#nav-home', '#nav-explore', '#nav-media-vault', '#settings-trigger']) {
        const box = await page.locator(id).boundingBox();
        expect(box, `${id} must be laid out`).not.toBeNull();
        expect(box.height, `${id} must be at least 44px tall`).toBeGreaterThanOrEqual(44);
        expect(box.y + box.height, `${id} must sit inside the viewport`).toBeLessThanOrEqual(size.height + 1);
      }
    });

    test('settings scroll inside the dialog rather than the page', async ({ page }) => {
      await stubSources(page, { posts: () => ({ json: [] }) });
      await page.goto('/?m=r34');
      await page.locator('#settings-trigger').click();

      const modal = page.locator('#settings-modal');
      await expect(modal).toBeVisible();

      const box = await modal.boundingBox();
      expect(box.width, 'the dialog must fit the screen').toBeLessThanOrEqual(size.width);
      expect(box.height).toBeLessThanOrEqual(size.height);

      const close = await page.locator('#close-settings').boundingBox();
      expect(close.x).toBeGreaterThanOrEqual(0);
      expect(close.y).toBeGreaterThanOrEqual(0);
      expect(close.x + close.width).toBeLessThanOrEqual(size.width + 1);

      const scrollable = await modal.evaluate(el => {
        const body = el.querySelector('.settings-body') || el.lastElementChild;
        return body ? body.scrollHeight > body.clientHeight || getComputedStyle(body).overflowY === 'auto' : false;
      });
      expect(scrollable, 'the settings body must scroll on its own').toBe(true);

      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });

    test('the viewer close button is reachable and nothing is clipped', async ({ page }) => {
      await stubSources(page, { posts: () => ({ json: [makePost('r34', '1'), makePost('r34', '2')] }) });
      await page.goto('/?m=r34');
      await page.locator('#search-input').fill('example_tag');
      await page.locator('#search-input').press('Enter');
      await page.locator('#card-r34\\:1').click();

      const close = page.locator('#close-viewer');
      await expect(close).toBeVisible();
      const box = await close.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);

      // And it actually closes, rather than being covered by the media.
      await close.click();
      await expect(page.locator('#media-viewer')).toBeHidden();
    });

    test('the grid size preference still changes the layout', async ({ page }) => {
      await stubSources(page, {
        posts: () => ({ json: Array.from({ length: 12 }, (_, i) => makePost('r34', String(400 + i))) })
      });
      await page.goto('/?m=r34');
      await expect(page.locator('.media-card').first()).toBeVisible();

      const columnCount = () => page.evaluate(() =>
        getComputedStyle(document.getElementById('media-grid')).gridTemplateColumns.split(/\s+/).filter(Boolean).length
      );
      const chooseSize = async (value) => {
        await page.locator('#settings-trigger').click();
        await page.locator('#grid-size-select').selectOption(value);
        await page.locator('#close-settings').click();
        await expect(page.locator('.media-card').first()).toBeVisible();
      };

      await chooseSize('large');
      const large = await columnCount();
      await chooseSize('small');
      const small = await columnCount();

      // The desktop track sizes all collapse to one column on a phone, so this
      // is the assertion that the preference still does something here.
      expect(small, 'a small grid must fit more columns than a large one').toBeGreaterThan(large);
      expect(await page.locator('.media-card').first().boundingBox().then(b => b.width))
        .toBeLessThanOrEqual(size.width);

      const { scrollWidth, clientWidth } = await horizontalOverflow(page);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    });
  });
}
