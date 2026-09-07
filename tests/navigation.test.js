import test from 'node:test';
import assert from 'node:assert/strict';

import { isSafeExternalUrl, openExternal, setNavigationPlugins } from '../src/navigation.js';

test('only the two source sites can be opened externally', () => {
  for (const good of [
    'https://rule34.xxx/index.php?page=post&s=view&id=42',
    'https://gelbooru.com/index.php?page=post&s=view&id=42',
    'https://api.rule34.xxx/index.php',
    'https://wimg.rule34.xxx/images/1/a.jpg'
  ]) {
    assert.equal(isSafeExternalUrl(good), true, `${good} should be allowed`);
  }
});

test('hostile and lookalike addresses are refused', () => {
  const bad = [
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    'data:text/html,<script>fetch("/steal")</script>',
    'file:///etc/passwd',
    'capacitor://localhost/secret',
    'nexus://open',
    'http://rule34.xxx/index.php',
    'https://rule34.xxx.attacker.test/index.php',
    'https://notrule34.xxx/index.php',
    'https://gelbooru.com.evil.test/',
    'https://user:pass@gelbooru.com/',
    'https://gelbooru.com:8443/',
    'https://127.0.0.1/',
    'https://localhost:5000/api/track/search',
    'https://10.0.0.5/',
    'https://192.168.1.4/',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    '',
    null,
    undefined,
    'not a url'
  ];
  for (const value of bad) {
    assert.equal(isSafeExternalUrl(value), false, `${String(value)} must be refused`);
  }
});

test('openExternal hands validated links to the system browser and refuses the rest', async () => {
  const opened = [];
  setNavigationPlugins({ Browser: { open: ({ url }) => { opened.push(url); return Promise.resolve(); } } });

  assert.equal(await openExternal('https://rule34.xxx/index.php?page=post&s=view&id=42'), true);
  assert.deepEqual(opened, ['https://rule34.xxx/index.php?page=post&s=view&id=42']);

  assert.equal(await openExternal('javascript:alert(1)'), false);
  assert.equal(await openExternal('https://evil.test/'), false);
  assert.equal(opened.length, 1, 'a refused link never reaches the browser plugin');

  setNavigationPlugins(null);
});
