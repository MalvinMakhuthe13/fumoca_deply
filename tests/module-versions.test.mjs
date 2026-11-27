// A module imported under two different ?v= cache keys runs twice on the page
// (two separate copies with their own state). Every importer must agree.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const files = [...readdirSync(join(root, 'js/modules')).filter(f => f.endsWith('.js')).map(f => join('js/modules', f)),
  ...readdirSync(root).filter(f => f.endsWith('.html')).map(f => f)];
const seen = new Map();   // module file -> Map(version -> [importers])
const re = /(?:import\s*(?:[^'"]*?from\s*)?|import\(\s*|src=)["'](?:\.\/|\.\.\/js\/modules\/|js\/modules\/|\/js\/modules\/)?([\w.-]+\.js)\?v=([\w.-]+)["']/g;
for (const f of files) {
  const text = readFileSync(join(root, f), 'utf8');
  for (const m of text.matchAll(re)) {
    const [, mod, v] = m;
    if (!seen.has(mod)) seen.set(mod, new Map());
    const byV = seen.get(mod); if (!byV.has(v)) byV.set(v, []); byV.get(v).push(f);
  }
}
const bad = [];
for (const [mod, byV] of seen) if (byV.size > 1) bad.push(`${mod}: ${[...byV].map(([v, fs]) => `${v} (${fs.join(', ')})`).join(' vs ')}`);
assert.deepEqual(bad, [], 'modules imported under different versions:\n' + bad.join('\n'));
console.log(`module versions: ${seen.size} versioned modules, all consistent`);
