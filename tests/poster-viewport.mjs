import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculatePosterViewport } from '../js/modules/poster-viewport.js';

const portrait = calculatePosterViewport({
  enabled: true,
  composition: {
    aspectRatio: 9 / 16,
    safeArea: 0.07,
    background: { type: 'solid', value: '#10131a' },
    title: { visible: true, text: 'Story title', align: 'center', fontFamily: 'Georgia, serif', fontSize: 64, color: '#ffeeaa', weight: 800 },
  },
}, 1200, 800);
assert.ok(Math.abs(portrait.width - 450) < 1e-9);
assert.equal(portrait.height, 800);
assert.equal(portrait.left, 375);
assert.equal(portrait.top, 0);
assert.equal(portrait.aspectRatio, 9 / 16);
assert.ok(Math.abs(portrait.safe.left - 31.5) < 1e-9);
assert.equal(portrait.title.text, 'Story title');
assert.equal(portrait.title.fontFamily, 'Georgia, serif');
assert.equal(portrait.title.fontSize, 64);
assert.equal(portrait.title.color, '#ffeeaa');
assert.equal(portrait.title.weight, 800);
const responsiveHeadlinePx = portrait.title.fontSize * (portrait.width / 1080);
assert.ok(Math.abs(responsiveHeadlinePx - (64 * 450 / 1080)) < 1e-9, 'Headline design size should scale against the 1080px poster reference canvas');

const landscape = calculatePosterViewport({
  enabled: true,
  composition: { aspectRatio: 16 / 9, safeArea: 0.05 },
}, 390, 844);
assert.equal(landscape.width, 390);
assert.ok(Math.abs(landscape.height - 219.375) < 1e-9);
assert.equal(landscape.left, 0);
assert.ok(Math.abs(landscape.top - 312.3125) < 1e-9);

assert.equal(calculatePosterViewport({ enabled: false, composition: { aspectRatio: 1 } }, 800, 600), null);
assert.equal(calculatePosterViewport({ enabled: true, composition: { aspectRatio: 0 } }, 800, 600), null);

const viewportModule = readFileSync(new URL('../js/modules/poster-viewport.js', import.meta.url), 'utf8');
assert.match(viewportModule, /const host = stage;/,
  'Editorial DOM layers must remain in the poster host alongside supporting images and text');
assert.ok(viewportModule.includes("const host = stage;"), 'Editorial and WebGL layers share the Studio viewport host');
assert.ok(viewportModule.includes("const renderer = new THREE.WebGLRenderer") === false, 'Viewport module remains renderer-agnostic');
assert.ok(viewportModule.includes("zIndex: '3'"), 'Editorial canvas sits above the live WebGL scene');
assert.match(viewportModule, /overflow: 'hidden', clipPath: 'inset\(0\)', isolation: 'isolate', contain: 'layout paint'/,
  'The poster artboard is an isolated clipping boundary for every editorial layer');
assert.match(viewportModule, /pointerEvents: 'none', overflow: 'hidden', clipPath: 'inset\(0\)'/,
  'Poster background effects must be clipped to the artboard');
assert.match(viewportModule, /backgroundNode\.style\.transform = 'none'/,
  'Background blur must not scale the background layer beyond the poster boundary');
assert.ok(viewportModule.includes("zIndex: '1'"), 'Poster background sits behind the live WebGL scene');
assert.ok(viewportModule.includes("host.insertBefore(backgroundNode, host.firstChild)"), 'Studio background is a sibling behind the renderer, not an opaque child above it');
assert.ok(viewportModule.includes("width: layout.width + 'px'"), 'Poster background and editorial canvas use the calculated poster dimensions');
assert.ok(viewportModule.includes("posterCanvas.style.display = 'none'"), 'Poster editorial canvas is hidden when poster composition is disabled');
assert.ok(viewportModule.includes("measureEl"), 'Available space is measured from the stable host without resizing the main viewport');
assert.match(viewportModule, /rect\.width - layout\.left - layout\.width/,
  'The renderer clip must use the measured host width, not an undefined bounds variable');
assert.match(viewportModule, /rect\.height - layout\.top - layout\.height/,
  'The renderer clip must use the measured host height, not an undefined bounds variable');
assert.match(viewportModule, /rendererCanvas\.style\.clipPath = clip/,
  'Studio WebGL pixels must be clipped to the poster frame');
assert.match(viewportModule, /const clip = `inset\(\$\{layout\.top\}px \$\{right\}px \$\{bottom\}px \$\{layout\.left\}px\)`/,
  'The renderer clip must use the measured poster frame edges');
assert.match(viewportModule, /orbitControls\.enablePan = false/,
  'Poster mode must prevent camera panning from carrying the scene outside the frame');
assert.match(viewportModule, /orbitControls\.enableZoom = false/, 'Poster framing disables free wheel zoom in favour of the fixed zoom control');
assert.match(viewportModule, /activeCamera\.zoom = .*framingZoom/, 'The poster zoom control is applied to the Studio camera projection');
assert.match(viewportModule, /framing: state\.composition\?\.framing/, 'Framing changes invalidate the viewport render signature');
assert.match(viewportModule, /restoreRendererBounds\(\)/,
  'Disabling poster mode must restore the normal renderer and camera controls');

const editorOverlay = readFileSync(new URL('../js/modules/poster-editor-overlay.js', import.meta.url), 'utf8');
assert.match(editorOverlay, /const clampToFrame =/,
  'Poster editor handles must have a shared frame-boundary clamp');
assert.match(editorOverlay, /pick\.style\.left = clampToFrame/,
  'Secondary-object selection handles stay inside the poster frame');
assert.match(editorOverlay, /const px=clampToFrame/,
  'The selected subject move handle stays inside the poster frame');
assert.match(editorOverlay, /scaleHandle\.style\.left=clampToFrame/,
  'The scale handle cannot drift outside the poster frame');
assert.match(editorOverlay, /rotateHandle\.style\.left=clampToFrame/,
  'The rotate handle cannot drift outside the poster frame');

const posterAssets = readFileSync(new URL('../js/modules/poster-assets.js', import.meta.url), 'utf8');
assert.match(posterAssets, /const layerRect = layer\.getBoundingClientRect\(\)/,
  'Image-layer drag bounds must use the actual rendered layer dimensions');
assert.match(posterAssets, /const minX = clamp\(-leftInset/,
  'Image-layer dragging must keep its complete left edge inside the poster');
assert.match(posterAssets, /const maxX = clamp\(\(rect\.width - rightInset\)/,
  'Image-layer dragging must keep its complete right edge inside the poster');
assert.match(posterAssets, /const minY = clamp\(-topInset/,
  'Image-layer dragging must keep its complete top edge inside the poster');
assert.match(posterAssets, /const maxY = clamp\(\(rect\.height - bottomInset\)/,
  'Image-layer dragging must keep its complete bottom edge inside the poster');

console.log('Poster viewport geometry and Studio renderer-host tests passed.');
