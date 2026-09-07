// Guards against a class of corruption that is invisible in a diff: stray
// control characters landing inside string or regex literals.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'ios']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(js|mjs|css|html|json|py|md)$/.test(entry)) out.push(full);
  }
  return out;
}

let bad = 0;
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    // Anything outside printable ASCII plus tab, minus the legitimate
    // non-ASCII characters the interface actually uses.
    const match = line.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/);
    if (match) {
      console.error(`${relative(ROOT, file)}:${i + 1} contains control character 0x${match[0].charCodeAt(0).toString(16)}`);
      bad++;
    }
  });
}

if (bad) {
  console.error(`${bad} line(s) carry stray control characters`);
  process.exit(1);
}
console.log('Encoding check clean: no stray control characters.');
