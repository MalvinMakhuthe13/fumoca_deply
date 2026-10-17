import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/fourd-capture.js', import.meta.url), 'utf8');
assert.match(source, /const escapeHtml = value => String\(value \?\? ''\)/,
  '4D UI must have a single HTML escaping helper');
assert.match(source, /escapeHtml\(result\.strategy\.label\)/, 'strategy labels must be escaped');
assert.match(source, /escapeHtml\(result\.strategy\.tip\)/, 'strategy tips must be escaped');
assert.match(source, /escapeHtml\(step\.label\)/, 'tracking step labels must be escaped');
assert.match(source, /escapeHtml\(step\.hint\)/, 'tracking hints must be escaped');
assert.match(source, /escapeHtml\(c\.file\.name\)/, 'user-supplied video filenames must be escaped');
assert.match(source, /escapeHtml\(s\.label\)/, 'persisted motion-state labels must be escaped');
assert.match(source, /replace\(\/\[\^A-Za-z0-9_-\]\/g, ''\)/,
  'persisted motion-state IDs must not be interpolated into executable attributes');
assert.match(source, /status-\$\{\['queued', 'processing', 'completed', 'failed', 'cancelled'\]\.includes\(j\.status\)/,
  'job status CSS classes must be allowlisted');
assert.match(source, /node\.textContent=String\(msg \?\? 'Tracking failed\.'\)/,
  'tracking errors must render as text, not HTML');
assert.match(source, /node\.textContent=String\(msg \?\? 'Analysis failed\.'\)/,
  'analysis errors must render as text, not HTML');
console.log('4D capture dynamic HTML injection regression checks passed.');
