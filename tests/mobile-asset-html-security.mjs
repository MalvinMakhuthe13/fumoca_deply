import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/mobile-asset.js', import.meta.url), 'utf8');
const start = source.indexOf('  function _generateWidgetHTML(config, record) {');
const end = source.indexOf('\n  // ── Generate PWA manifest', start);
assert.ok(start >= 0 && end > start, 'mobile widget HTML generator must exist');
const declaration = source.slice(start, end);
const generate = new Function('location', `${declaration}; return _generateWidgetHTML;`)({
  origin: 'https://fumoca.example',
});

const html = generate(
  { web_link: 'javascript:alert(1)', states: [{ id: 'x', label: '</script><script>alert(1)</script>' + String.fromCharCode(0x2028, 0x2029) }] },
  {
    id: 'asset-1',
    title: '</title><script>alert(2)</script>',
    thumbnail_url: 'javascript:alert(3)',
  },
);
assert.ok(!html.includes('</title><script>alert(2)</script>'), 'record title must be HTML-escaped');
assert.ok(!html.includes('src="javascript:alert(3)"'), 'thumbnail URL must reject javascript: schemes');
assert.ok(!html.includes('href="javascript:alert(1)"'), 'widget link must reject javascript: schemes');
assert.ok(!html.includes('</script><script>alert(1)</script>'), 'state JSON must not be able to terminate its inline script');
assert.ok(html.includes('\\u003c/script>'), 'script-sensitive less-than signs must be JSON escaped');
console.log('Mobile widget HTML escaping and URL scheme checks passed.');
