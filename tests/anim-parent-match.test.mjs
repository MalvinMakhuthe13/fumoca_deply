/**
 * registerArticulatedObject must reject a node whose Three parent
 * is not the node bound to parentId.
 * Run: node tests/anim-parent-match.test.mjs
 */
globalThis.window = globalThis;
await import('../js/modules/anim-joint-eval.js');
await import('../js/modules/anim-master.js');
const { default: Studio } = await import('../js/modules/anim-studio-init.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

function node() { return { parent: null }; }
function parentTo(parent, child) { child.parent = parent; return child; }

const base = node();
const lid = parentTo(base, node());
const matched = Studio.registerArticulatedObject({
  id: 'matched',
  components: [
    { id: 'base', parentId: null },
    { id: 'lid', parentId: 'base' },
  ],
}, new Map([['base', base], ['lid', lid]]));
assert(matched.ok === true && matched.missing.length === 0, 'Matching node.parent accepted');

const wrongLid = node();
const mismatch = Studio.registerArticulatedObject({
  id: 'mismatch',
  components: [
    { id: 'base', parentId: null },
    { id: 'lid', parentId: 'base' },
  ],
}, new Map([['base', base], ['lid', wrongLid]]));
assert(mismatch.ok === false && mismatch.reason === 'parent_mismatch' && mismatch.componentId === 'lid', 'Wrong node.parent rejected');

const unknown = Studio.registerArticulatedObject({
  id: 'unknown',
  components: [{ id: 'lid', parentId: 'missing' }],
}, new Map([['lid', node()]]));
assert(unknown.ok === false && unknown.reason === 'unknown_parent', 'Unknown parent id still rejected');

const saved = window.FumocaMaster.serialize();
assert(saved.objects.some(o => o.id === 'matched'), 'Matched object was registered');
assert(!saved.objects.some(o => o.id === 'mismatch'), 'Mismatched object was not registered');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
