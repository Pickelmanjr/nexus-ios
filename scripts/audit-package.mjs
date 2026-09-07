// Package boundary audit.
//
// Scans the shipped source (and dist/, when it has been built) for anything the
// mobile build must not contain: removed sources, desktop/proxy endpoints,
// embedded credentials, remote script tags and unresolved local references.
//
// Run as `npm run check`. `scanText` is exported so the test suite can prove the
// scanner actually catches a planted leak rather than only approving the real
// files.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Each rule is [name, pattern, why].
export const FORBIDDEN = [
  ['removed-source-f95', /\bf95(zone)?\b/i, 'F95Zone is not part of this build'],
  ['removed-source-lewd', /lewd\.ninja|\blewdData\b|'lewd'|"lewd"/i, 'Lewd.ninja is not part of this build'],
  // Matches an actual request to a local machine (a scheme or a port), not a
  // mere mention -- navigation.js has to name these hosts in order to block
  // them, and minification strips the comment that would exempt it.
  ['local-backend', /\bhttps?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)|\b(localhost|127\.0\.0\.1):\d{2,5}/i, 'the packaged app must not call a machine on the local network'],
  ['image-proxy', /wsrv\.nl|allorigins|corsproxy|codetabs\.com|thingproxy/i, 'no public proxy may stand between the app and a source'],
  ['extension-bridge', /NEXUS_WEB|requestExt|bridgeActive|chrome\.runtime/, 'the desktop browser-extension bridge is gone'],
  ['ai-feature', /ollama|aiChatHistory|sendAIChat|openAIChatForVideo/i, 'the AI assistant is not part of this build'],
  ['local-media', /localMedia|processZip|handleFolderSelect|JSZip/i, 'local ZIP/folder import is not part of this build'],
  ['game-feature', /openGameViewer|game_likes|game_tag_stats|game-viewer/i, 'the game viewer is not part of this build'],
  ['remote-script', /<script[^>]+src=["']https?:/i, 'all executable code must be bundled'],
  ['remote-stylesheet', /<link[^>]+href=["']https?:\/\/(?!fonts\.)/i, 'all styles must be bundled'],
  ['inline-event-handler', /\son(click|error|load|change|submit|mouseover)\s*=\s*["']/i, 'inline handlers do not survive the content security policy'],
  ['credential-literal', /(user_id|api_key|apikey)\s*[:=]\s*["'][A-Za-z0-9]{6,}["']/i, 'no account credential may be committed'],
  // Shaped like the two literals that were embedded in the desktop source: a
  // numeric user id and a long hex key.
  ['credential-field', /\buid\s*:\s*["']\d{4,}["']|\bkey\s*:\s*["'][A-Fa-f0-9]{16,}["']/, 'no account credential may be committed']
];

const SCAN_DIRS = ['src', 'scripts'];
const SCAN_FILES = ['index.html', 'capacitor.config.json', 'vite.config.js', 'package.json'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'docs', 'tests', 'ios']);

// A file may opt out of one rule with `audit-allow: <rule-name>` plus a reason.
// It is deliberately per-rule and greppable: broad exemptions are how a scanner
// quietly stops scanning anything.
const ALLOW_MARKER = /audit-allow:\s*([a-z-]+)/gi;

export function allowedRules(text) {
  return new Set([...text.matchAll(ALLOW_MARKER)].map(m => m[1].toLowerCase()));
}

/** Return the rules a piece of text violates. */
export function scanText(text, { only, respectAllowMarkers = true } = {}) {
  const allowed = respectAllowMarkers ? allowedRules(text) : new Set();
  return FORBIDDEN
    .filter(([name]) => !only || only.includes(name))
    .filter(([name]) => !allowed.has(name))
    .filter(([, pattern]) => pattern.test(text))
    .map(([name, , why]) => ({ name, why }));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs|css|html|json)$/.test(entry)) out.push(full);
  }
  return out;
}

export function collectFiles(root = ROOT) {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const full = join(root, dir);
    if (existsSync(full)) walk(full, files);
  }
  for (const file of SCAN_FILES) {
    const full = join(root, file);
    if (existsSync(full)) files.push(full);
  }
  const dist = join(root, 'dist');
  if (existsSync(dist)) walk(dist, files);
  return files;
}

/** Every local href/src in index.html must resolve to a real file. */
export function checkLocalReferences(root = ROOT) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const problems = [];
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const ref = match[1];
    if (/^(https?:|data:|blob:|#|mailto:)/.test(ref)) continue;
    const target = join(root, ref.replace(/^\//, '').split('?')[0]);
    if (!existsSync(target)) problems.push(ref);
  }
  return problems;
}

export function audit(root = ROOT) {
  const findings = [];
  for (const file of collectFiles(root)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    const text = readFileSync(file, 'utf8');
    // This file names the forbidden patterns in order to search for them.
    if (rel === 'scripts/audit-package.mjs' || rel.startsWith('scripts/extract-')) continue;
    for (const hit of scanText(text)) findings.push({ file: rel, ...hit });
  }
  for (const ref of checkLocalReferences(root)) {
    findings.push({ file: 'index.html', name: 'unresolved-reference', why: `${ref} does not exist` });
  }
  return findings;
}

function main() {
  const findings = audit();
  const built = existsSync(join(ROOT, 'dist'));

  // Negative self-test: a scanner that never fires proves nothing.
  const planted = scanText('const conf = { uid: "1111111", key: "abcdef0123456789" };');
  const plantedEndpoint = scanText('fetch("http://localhost:5000/api/track/search")');
  if (planted.length === 0 || plantedEndpoint.length === 0) {
    console.error('audit self-test failed: the scanner did not catch planted violations');
    process.exit(2);
  }

  if (findings.length) {
    console.error('Package audit failed:');
    for (const f of findings) console.error(`  ${f.file}: ${f.name} — ${f.why}`);
    process.exit(1);
  }
  console.log('Package audit clean (%s). Self-test caught %d planted violations.',
    built ? 'source and dist' : 'source only; run npm run build to audit dist',
    planted.length + plantedEndpoint.length);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('audit-package.mjs')) {
  main();
}
