import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pro = readFileSync('js/modules/hotspot-pro.js', 'utf8');
const persist = readFileSync('js/modules/hotspot-persist.js', 'utf8');
const layer = readFileSync('engine-next/editor/NIFHotspotLayer.js', 'utf8');
const viewer = readFileSync('viewer.html', 'utf8');

assert.match(pro, /const hotspotElements = new Map\(\)/, 'Hotspots Pro should reuse DOM markers');
assert.match(pro, /for \(const \[id, el\] of hotspotElements\)/, 'stale hotspot markers should be removed by ID');
assert.doesNotMatch(pro, /function renderHotspots\(\) \{[\s\S]{0,180}hotspotLayer\.innerHTML\s*=\s*''/, 'render loop must not clear and recreate the full layer');
assert.match(pro, /fumoca:hotspotSaveFailed/, 'remote persistence failures must be surfaced as an event');
assert.match(pro, /Save failed — local backup only/, 'UI must distinguish local-only backup from remote save');
assert.match(pro, /hotspotInfoCard\.animate/, 'hotspot details should animate into view after the camera flight starts');
assert.match(pro, /prefers-reduced-motion: reduce/, 'cinematic card motion must respect reduced-motion preferences');
assert.match(pro, /getAnimations\?\.\(\)\.forEach\(animation => animation\.cancel\(\)\)/, 'rapid hotspot changes and close actions must cancel stale card animations');

assert.match(layer, /this\._editable && this\._addMode \? 'auto' : 'none'/, 'overlay should capture pointer events only while placing');
assert.match(layer, /this\._overlayCanvas\.style\.pointerEvents = 'auto'/, 'add mode must enable pointer events');
assert.match(layer, /this\._resizeObserver\?\.disconnect\(\)/, 'destroy must release ResizeObserver');
assert.match(layer, /if \(committed\) return/, 'label commit should be idempotent');

assert.match(persist, /hotspots\.length && !window\._fumocaUseHotspotPro/, 'legacy persistence renderer must not duplicate Hotspots Pro markers');
assert.match(viewer, /fumoca:hotspotsSeeded/, 'demo hotspots should route through Hotspots Pro when active');

console.log('Hotspot rendering, placement, persistence-status and duplicate-render contracts passed.');
