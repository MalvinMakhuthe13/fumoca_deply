/**
 * Founder gate. Empty allowlist blocks. Matching email passes.
 * Run: node tests/founder-gate.test.mjs
 */
globalThis.window = { FUMOCA_FOUNDER_EMAILS: ['founder@fumoca.co.za'] };
const { default: Gate } = await import('../js/modules/founder-gate.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; }
  else { console.log('PASS:', msg); passed++; }
}

assert(Gate.allowlist().includes('founder@fumoca.co.za'), 'Allowlist reads founder email');
window.FUMOCA_FOUNDER_EMAILS = [];
assert(Gate.allowlist().length === 0, 'Empty allowlist blocks');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
