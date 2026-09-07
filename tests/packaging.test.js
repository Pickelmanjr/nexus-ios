import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { audit, scanText, checkLocalReferences, ROOT } from '../scripts/audit-package.mjs';

const read = name => readFileSync(join(ROOT, name), 'utf8');
const html = () => read('index.html');

test('the shipped files exist', () => {
  for (const file of [
    'index.html', 'package.json', 'vite.config.js', 'capacitor.config.json',
    'src/main.js', 'src/app.js', 'src/styles.css', 'src/sources.js', 'src/network.js',
    'src/platform.js', 'src/storage.js', 'src/backup.js', 'src/files.js', 'src/navigation.js'
  ]) {
    assert.ok(existsSync(join(ROOT, file)), `${file} must exist`);
  }
});

test('the gateway offers exactly two sources', () => {
  const modes = [...html().matchAll(/class="gw-card ([a-z0-9]+)"/g)].map(m => m[1]);
  assert.deepEqual(modes.sort(), ['gel', 'r34']);
  const dataModes = [...html().matchAll(/data-mode="([a-z0-9_]+)"/g)].map(m => m[1]);
  assert.deepEqual(dataModes.sort(), ['gel', 'r34']);
});

test('the removed features leave no markup behind', () => {
  const markup = html();
  for (const id of [
    'f95-sidebar', 'sidebar-toggle', 'local-zip-view', 'nav-game-vault', 'nav-local',
    'ai-chat-home', 'ai-chat-shell', 'game-viewer', 'local-dropzone', 'local-zip-input'
  ]) {
    assert.ok(!markup.includes(`id="${id}"`), `${id} must be gone from the markup`);
  }
  for (const view of ['game_vault', 'local']) {
    assert.ok(!markup.includes(`data-view="${view}"`), `${view} must not be reachable from the tab bar`);
  }
});

test('the retained interface is intact', () => {
  const markup = html();
  const required = [
    'gateway-screen', 'app-layout', 'search-input', 'suggestions-list', 'media-grid',
    'loader', 'end-of-results', 'keep-up-view', 'keep-up-content', 'reels-view',
    'reels-container', 'media-viewer', 'lightbox-media-container', 'lightbox-sidebar',
    'viewer-stats', 'viewer-tags', 'viewer-fav-btn', 'viewer-like-btn', 'viewer-save-btn',
    'settings-modal', 'previous-searches-panel', 'saved-tags-list', 'fav-tags-list',
    'bl-tags-list', 'track-tags-list', 'grid-size-select', 'sort-select',
    'backup-btn', 'restore-btn', 'restore-file-input', 'reset-algo-btn',
    'nav-media-vault', 'nav-reels', 'nav-keep-up'
  ];
  for (const id of required) {
    assert.ok(markup.includes(`id="${id}"`), `${id} must still exist`);
  }
  for (const view of ['home', 'explore', 'reels', 'keep_up', 'vault']) {
    assert.ok(markup.includes(`data-view="${view}"`), `${view} must stay reachable`);
  }
});

test('both sources have reachable account settings', () => {
  const markup = html();
  for (const source of ['r34', 'gel']) {
    for (const id of [`${source}-uid-input`, `${source}-key-input`, `save-${source}-creds-btn`, `clear-${source}-creds-btn`, `${source}-creds-status`]) {
      assert.ok(markup.includes(`id="${id}"`), `${id} must exist`);
    }
  }
  // The API key field is masked and free of iOS text assistance.
  const keyFields = [...html().matchAll(/<input[^>]*id="(?:r34|gel)-key-input"[^>]*>/g)].map(m => m[0]);
  assert.equal(keyFields.length, 2);
  for (const field of keyFields) {
    assert.match(field, /type="password"/);
    assert.match(field, /autocapitalize="off"/);
    assert.match(field, /autocorrect="off"/);
  }
});

test('no executable asset is loaded from off-device', () => {
  const markup = html();
  assert.ok(!/<script[^>]+src=["']https?:/i.test(markup), 'no remote script');
  assert.ok(!/<link[^>]+href=["']https?:/i.test(markup), 'no remote stylesheet');
  assert.ok(!/JSZip|jszip/i.test(markup), 'the CDN zip library is gone');

  const scripts = [...markup.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /src=/, 'every script tag must load a bundled file');
    assert.equal(body.trim(), '', 'no inline script may run under the content security policy');
  }
  assert.ok(markup.includes('src="/src/main.js"'), 'the module entry is bundled');
});

test('the content security policy pins scripts, frames and connections', () => {
  const csp = html().match(/http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(csp, 'a CSP meta tag must be present');
  const policy = csp[1];
  assert.match(policy, /script-src 'self'/);
  assert.ok(!policy.includes('unsafe-eval'), 'no eval');
  assert.ok(!/script-src[^;]*unsafe-inline/.test(policy), 'no inline scripts');
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.rule34\.xxx https:\/\/gelbooru\.com/);
});

test('the viewport opts into the safe area', () => {
  assert.match(html(), /name="viewport"[^>]*viewport-fit=cover/);
});

test('there are no inline event handlers anywhere in the markup', () => {
  assert.ok(!/\son(click|error|load|change|submit|mouseover)\s*=/i.test(html()));
});

test('every local reference in the markup resolves', () => {
  assert.deepEqual(checkLocalReferences(), []);
});

test('no source credential is committed anywhere', () => {
  for (const file of ['src/app.js', 'src/sources.js', 'index.html', 'src/storage.js']) {
    const text = read(file);
    assert.ok(!/\buid\s*:\s*["']\d{4,}["']/.test(text), `${file} must not carry a user id`);
    assert.ok(!/\bkey\s*:\s*["'][A-Fa-f0-9]{16,}["']/.test(text), `${file} must not carry an API key`);
    assert.ok(!/(user_id|api_key)\s*[:=]\s*["'][A-Za-z0-9]{6,}["']/i.test(text), `${file} must not carry credentials`);
  }
});

test('the whole package audit is clean', () => {
  assert.deepEqual(audit(), []);
});

test('the audit scanner actually catches planted violations', () => {
  // A scanner that only ever approves the real files proves nothing.
  const planted = [
    ['const conf = { uid: "1111111", key: "0123456789abcdef0" };', 'credential-field'],
    ['fetch("http://localhost:5000/api/track/search")', 'local-backend'],
    ['this.src = "https://wsrv.nl/?url=" + encodeURIComponent(u)', 'image-proxy'],
    ['const url = "https://f95zone.to/sam/latest_alpha/data.json"', 'removed-source-f95'],
    ['<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>', 'remote-script'],
    ['<img src="x" onerror="alert(1)">', 'inline-event-handler'],
    ['await DB.requestExt("RESET_ALGO", {})', 'extension-bridge'],
    ['const store = "game_likes"', 'game-feature']
  ];
  for (const [text, rule] of planted) {
    const hits = scanText(text).map(h => h.name);
    assert.ok(hits.includes(rule), `the scanner must catch ${rule} in: ${text}`);
  }
});

test('the capacitor config bundles the app and disables http patching', () => {
  const config = JSON.parse(read('capacitor.config.json'));
  assert.equal(config.appName, 'Nexus');
  assert.equal(config.appId, 'com.nexus.personal');
  assert.equal(config.webDir, 'dist');
  assert.equal(config.server, undefined, 'no remote server may back the packaged app');
  assert.equal(config.plugins.CapacitorHttp.enabled, false, 'global fetch patching stays off');
  // limitsNavigationsToAppBoundDomains is deliberately absent: Capacitor only
  // honours it alongside a WKAppBoundDomains list in Info.plist, and that key
  // blocks plugin injection. External navigation is prevented by the CSP, by
  // opening source links through the Browser plugin, and by having no anchors.
  assert.equal(config.ios.limitsNavigationsToAppBoundDomains, undefined);
  assert.ok(!/WKAppBoundDomains/.test(read('ios/App/App/Info.plist')));
  const text = read('capacitor.config.json');
  assert.ok(!text.includes('allowNavigation'), 'no remote navigation allowlist');
  assert.ok(!/NSAllowsArbitraryLoads/i.test(text), 'no blanket transport-security exception');
});

test('the build config emits a relative, source-map-free bundle', () => {
  const config = read('vite.config.js');
  assert.match(config, /base:\s*'\.\/'/);
  assert.match(config, /sourcemap:\s*false/);
  assert.match(config, /outDir:\s*'dist'/);
});

test('dependencies are pinned to exact versions', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned, got ${version}`);
  }
  assert.ok(existsSync(join(ROOT, 'package-lock.json')), 'the lockfile must be committed');
});

test('the controller exports itself instead of installing a global', () => {
  const source = read('src/app.js');
  assert.match(source, /^export const app = \{/m);
  assert.ok(!/window\.app\s*=/.test(source), 'no global app object');
  assert.ok(!/localStorage/.test(source), 'persistence goes through the storage module');
  const main = read('src/main.js');
  assert.match(main, /import \{ app \} from '\.\/app\.js'/);
});
