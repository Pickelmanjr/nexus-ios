// Static sanity check: every `this.foo(` in app.js must have a matching
// definition, and every named import must actually be used. Catches the
// dangling calls a feature removal leaves behind.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

const defined = new Set(
  [...source.matchAll(/^ {2}(?:async )?([A-Za-z_$][\w$]*)\s*\(/gm)].map(m => m[1])
);
// Plain data properties on the object literal count too.
for (const m of source.matchAll(/^ {2}([A-Za-z_$][\w$]*):/gm)) defined.add(m[1]);

const called = new Set([...source.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]));
const missing = [...called].filter(name => !defined.has(name));

const importBlock = source.slice(0, source.indexOf('export const app'));
const imported = [...importBlock.matchAll(/^\s*([A-Za-z_$][\w$]*)[,\s]*$/gm)].map(m => m[1]);
const body = source.slice(source.indexOf('export const app'));
const unusedImports = imported.filter(name => !new RegExp('\\b' + name + '\\b').test(body));

let failed = false;
if (missing.length) {
  console.error('Calls with no definition: ' + missing.join(', '));
  failed = true;
}
if (unusedImports.length) {
  console.error('Imported but unused: ' + unusedImports.join(', '));
  failed = true;
}
if (failed) process.exit(1);
console.log('app.js: %d methods defined, %d call sites, all resolved', defined.size, called.size);
