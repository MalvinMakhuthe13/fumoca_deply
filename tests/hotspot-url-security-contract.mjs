import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const actions = await readFile(new URL('../js/modules/hotspot-actions.js', import.meta.url), 'utf8');
assert.match(actions, /function safeHttpUrl\(value\)/, 'hotspot actions need a shared HTTP(S) URL validator');
assert.match(actions, /function safeMediaUrl\(value\)/, 'hotspot media must have a restricted URL validator');
assert.match(actions, /const safeUrl = safeMediaUrl\(url\);/, 'audio playback must validate its URL');
assert.match(actions, /const safeUrl = safeMediaUrl\(url\);[\s\S]*?player\.src = safeUrl;/, 'video overlay must validate its URL');
assert.match(actions, /const ctaUrl = safeHttpUrl\(cta\?\.url\)/, 'info-card CTAs must reject unsafe schemes');
assert.match(actions, /const url = safeHttpUrl\(action\.url\);[\s\S]*?window\.open\(url, '_blank', 'noopener,noreferrer'\)/,
  'link actions must validate URL schemes and force a safe target');

const hotspots = await readFile(new URL('../js/modules/hotspot-pro.js', import.meta.url), 'utf8');
assert.match(hotspots, /function safeHttpUrl\(value\)/, 'hotspot editor needs HTTP(S) URL validation');
assert.match(hotspots, /const audioUrl = safeMediaUrl\(h\.audioUrl\)/, 'legacy hotspot audio must validate its URL');
assert.match(hotspots, /const ctaUrl = safeHttpUrl\(h\.ctaLink\)/, 'legacy hotspot CTA links must be validated');
assert.match(hotspots, /const images = h\.gallery\.slice\(0, 6\)\.map\(safeHttpUrl\)\.filter\(Boolean\)/, 'gallery URLs must be filtered to HTTP(S)');
assert.match(hotspots, /const videoUrl = safeMediaUrl\(h\.mediaVideo\)/, 'hotspot video media must be validated');
assert.match(hotspots, /const imageUrl = safeHttpUrl\(h\.mediaImage\)/, 'hotspot image media must be validated');
assert.match(hotspots, /const overlayUrl = safeHttpUrl\(h\.overlayUrl\)/, 'nested overlay URLs must be validated');
console.log('Hotspot URL scheme and media injection guards passed.');
