// Author-supplied hotspot/CTA URLs must never allow script-capable schemes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
globalThis.window = { location: { href: 'https://fumoca.co.za/viewer.html?id=1', origin: 'https://fumoca.co.za' } };
const { safeHttpUrl, safeMediaUrl } = await import('../js/modules/safe-url.js');

for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'javascript:alert(1)//viewer.html', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'blob:https://evil.example/abc']) {
  assert.equal(safeHttpUrl(bad), '', `safeHttpUrl must reject ${bad}`);
  assert.equal(safeMediaUrl(bad), '', `safeMediaUrl must reject ${bad}`);
}
assert.equal(safeHttpUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
assert.equal(safeHttpUrl('/viewer.html?splatId=2'), 'https://fumoca.co.za/viewer.html?splatId=2');
assert.equal(safeMediaUrl('blob:https://fumoca.co.za/123'), 'blob:https://fumoca.co.za/123');

const pro = await readFile(new URL('../js/modules/hotspot-pro.js', import.meta.url), 'utf8');
const actions = await readFile(new URL('../js/modules/hotspot-actions.js', import.meta.url), 'utf8');
for (const [src, name] of [[pro, 'hotspot-pro'], [actions, 'hotspot-actions']]) {
  assert.match(src, /from '\.\/safe-url\.js'/, `${name} must use the shared URL guard`);
}
assert.doesNotMatch(pro, /href="\$\{escapeHtml\(h\.(ctaLink|link)\)\}"/, 'hotspot CTA links must be scheme-checked, not only HTML-escaped');
assert.doesNotMatch(pro, /src="\$\{escapeHtml\(h\.media(Video|Image)\)\}"/, 'hotspot media must be scheme-checked');
assert.match(pro, /const overlayUrl = safeHttpUrl\(h\.overlayUrl\)/, 'nested overlay iframes must be scheme-checked');
assert.match(actions, /const ctaUrl = safeHttpUrl\(cta\?\.url\)/, 'info-card CTA must be scheme-checked');
assert.doesNotMatch(actions, /window\.open\(action\.url/, 'link actions must not open unvalidated URLs');
console.log('Safe URL guards passed: javascript:/data:/foreign blob: rejected for hotspot links, media and overlays.');
