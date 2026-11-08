import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculatePosterViewport, calculatePosterCanvasClip } from '../js/modules/poster-viewport.js';

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
assert.equal(
  calculatePosterCanvasClip(
    { left: 100, top: 50, right: 1100, bottom: 750, width: 1000, height: 700 },
    { left: 250, top: 100, right: 850, bottom: 700 },
    500, 350
  ),
  'inset(25px 125px 25px 75px)',
  'Canvas-relative clipping must account for a renderer canvas whose CSS size differs from its rendered bounds'
);
assert.equal(
  calculatePosterCanvasClip(
    { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 },
    { left: 120, top: 120, right: 220, bottom: 220 },
    100, 100
  ),
  'inset(100%)',
  'A renderer canvas outside the poster frame must be fully clipped'
);


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




assert.match(viewportModule, /const syncRendererBindings = \(\) =>/, 'Poster mode must discover late-mounted renderer and controls');
assert.match(viewportModule, /viewerReadyCamera = event\.detail\?\.camera \|\| viewerReadyCamera/, 'Poster zoom must bind to the actual camera announced by viewerReady');
assert.match(viewportModule, /viewerReadyControls = event\.detail\?\.controls \|\| event\.detail\?\.viewer\?\.controls/, 'Poster mode must bind to the active viewer controls');
assert.match(viewportModule, /window\._fumocaRenderer\?\.camera/, 'Poster zoom can resolve the renderer camera even when the editor globals are absent');
assert.match(viewportModule, /window\._fumocaViewerControls/, 'Poster mode can resolve the active viewer controls outside Studio');
assert.match(viewportModule, /window\.addEventListener\('fumoca:viewerReady'/, 'Viewer readiness must trigger a fresh renderer binding pass');
assert.match(viewportModule, /const captureCanvas = window\._fumocaCaptureCanvas/, 'Poster clipping must prefer the exact active Spark canvas rather than the legacy placeholder');
assert.match(viewportModule, /viewerReadyControls \|\|[\s\S]*?window\._fumocaOrbitControls/,
  'Poster mode must bind the controls announced by the active viewer before any stale Studio controls');
assert.match(viewportModule, /orbitControls\.enablePan = true[\s\S]*?orbitControls\.enableZoom = true/,
  'Poster mode must preserve live camera pan and zoom as well as orbit');
assert.match(viewportModule, /activeCamera\.zoom = .*framingZoom/, 'The poster zoom control is applied to the Studio camera projection');
assert.match(viewportModule, /framing: state\.composition\?\.framing/, 'Framing changes invalidate the viewport render signature');
assert.match(viewportModule, /motion: state\.composition\?\.motion/, 'Motion changes invalidate the viewport render signature and are applied without a remount');
assert.match(viewportModule, /originalAutoRotate = orbitControls \? orbitControls\.autoRotate/, 'The viewer automatic-rotation state is captured before poster mode changes it');
assert.match(viewportModule, /originalAutoRotateSpeed = orbitControls \? orbitControls\.autoRotateSpeed/, 'The viewer automatic-rotation speed is captured before poster mode changes it');
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

const editorSubject = readFileSync(new URL('../js/modules/poster-editor-overlay.js', import.meta.url), 'utf8');
assert.match(editorSubject, /const x=clamp\(Number\(subject\.x\?\?\.5\),0,1\)/,
  'The selected 3D subject anchor can be placed anywhere across the poster width');
assert.match(editorSubject, /const y=clamp\(Number\(subject\.y\?\?\.53\),0,1\)/,
  'The selected 3D subject anchor can be placed anywhere across the poster height');
assert.match(editorSubject, /x:clamp\(g\.origin\.x[\s\S]*?0,1\)/,
  'Pointer movement keeps the 3D subject inside the horizontal poster boundary');
assert.match(editorSubject, /y:clamp\(g\.origin\.y[\s\S]*?0,1\)/,
  'Pointer movement keeps the 3D subject inside the vertical poster boundary');
assert.match(editorSubject, /patchSelected\(\{x:clamp\(x,0,1\),y:clamp\(y,0,1\)\}\)/,
  'Keyboard nudging obeys the same poster-safe subject boundary');

const magazineText = readFileSync(new URL('../js/modules/present-magazine-text.js', import.meta.url), 'utf8');
assert.match(magazineText, /startX \+ \(\(ev\.clientX - pointerX\) \/ width\) \* 100/,
  'Dragging text must preserve the original grab offset and use the live poster-layer width');
assert.match(magazineText, /const currentRect = target\.getBoundingClientRect\(\)/,
  'Text dragging must measure the live poster layer after viewport layout changes');
assert.match(magazineText, /__fumocaMagazineTextRuntime/,
  'The stable document pointer listener must always dispatch to the latest magazine text module instance');
assert.match(magazineText, /overflow: 'hidden', pointerEvents: 'none', zIndex: '20'/,
  'The full-size text layer must not block pointer events for image and headline layers');
const posterAssets = readFileSync(new URL('../js/modules/poster-assets.js', import.meta.url), 'utf8');
assert.match(posterAssets, /const layerRect = layer\.getBoundingClientRect\(\)/,
  'Image-layer drag bounds must use the actual rendered layer dimensions');
assert.match(posterAssets, /const startItemX = clamp\(\(layerRect\.left \+ layerRect\.width \/ 2/,
  'Image-layer dragging must convert corner/edge anchors to the rendered centre before movement');
assert.match(posterAssets, /patchItem\(item\.id, \{ anchor: 'free', x: startItemX, y: startItemY \}\)/,
  'Dragging an anchored image must switch it to a free centre anchor');
assert.match(posterAssets, /const x = clamp\(startItemX \+ \(ev\.clientX - startX\) \/ Math\.max\(1, rect\.width\), 0, 1\)/,
  'Image-layer anchors must be movable to either horizontal edge of the poster');
assert.match(posterAssets, /const y = clamp\(startItemY \+ \(ev\.clientY - startY\) \/ Math\.max\(1, rect\.height\), 0, 1\)/,
  'Image-layer anchors must be movable to either vertical edge of the poster');
assert.match(posterAssets, /const y = clamp\(startItemY \+ \(ev\.clientY - startY\) \/ Math\.max\(1, rect\.height\), 0, 1\)/,
  'Image-layer anchors must be movable to the bottom edge of the poster');


assert.match(viewportModule, /const Quaternion = activeCamera\?\.quaternion\?\.constructor/,
  'Studio trackball must derive Quaternion from the active camera instead of requiring a window.THREE global');
assert.doesNotMatch(viewportModule, /window\.THREE\?\.Quaternion|new window\.THREE\.Quaternion/,
  'Studio trackball must work when the renderer imports Three.js as a module without exposing window.THREE');
assert.match(viewportModule, /pointerEvents: isStudioEditor \? 'auto' : 'none'/,
  'The Studio headline must receive direct manipulation input while remaining inert in the public viewer');
assert.match(viewportModule, /title: \{\s*x: Math\.max\(0, Math\.min\(1, start\.x/,
  'Dragging the headline must persist a free poster-local X/Y position');
assert.match(viewportModule, /data-fumoca-poster-title/,
  'Headline drags must be excluded from the 3D trackball gesture');
assert.match(viewportModule, /data-poster-asset-id/,
  'Dragging a supporting image must not also start a 3D camera orbit');

assert.match(viewportModule, /previous: point\.clone\(\)/,
  'Arcball drag state must retain the previous camera-local sphere point');
assert.match(viewportModule, /trackballGesture\.previous\)/,
  'Arcball movement must read the same previous-point field it stores');
assert.match(viewportModule, /startQuaternion: activeCamera\.quaternion\.clone\(\)/,
  'Arcball rotation must retain the gesture starting orientation for stable world-space deltas');
assert.match(viewportModule, /base\.clone\(\)\.multiply\(deltaCamera\)\.multiply\(base\.clone\(\)\.invert\(\)\)/,
  'Arcball deltas must be transformed into world space to allow unrestricted pitch, yaw and roll');
assert.match(viewportModule, /const cameraBaseZoom = new WeakMap\(\)/,
  'Each live camera must retain its original zoom so repeated viewerReady events cannot compound poster zoom');
assert.match(viewportModule, /const cameraBaseAspect = new WeakMap\(\)/,
  'Each live camera must retain its original aspect ratio for restoration after poster mode');
assert.match(viewportModule, /cameraBaseAspect\.get\(activeCamera\)/,
  'Leaving poster mode must restore the camera aspect ratio that was active before poster framing');
assert.match(viewportModule, /viewerReadyCamera \|\| \(isStudioEditor/,
  'The camera announced by the active viewer takes precedence over stale editor globals');
assert.match(viewportModule, /!cameraBaseZoom\.has\(viewerReadyCamera\)/,
  'Repeated viewerReady events must not replace the unmodified camera zoom baseline');
assert.match(viewportModule, /cameraBaseZoom\.get\(activeCamera\)/,
  'Poster zoom must always be calculated from the original camera zoom');

assert.match(viewportModule, /motionLevel = state\.composition\?\.motion\?\.level/, 'Poster motion level is read from the saved composition');
assert.match(viewportModule, /gentle: 0\.35, normal: 0\.8, dynamic: 1\.5/, 'Explicit poster motion levels map to predictable automatic rotation speeds');
assert.match(viewportModule, /orbitControls\.autoRotate = true/, 'Explicit motion levels enable automatic rotation without disabling manual orbit');
assert.match(viewportModule, /orbitControls\.autoRotate = originalAutoRotate/, 'Still mode preserves the viewer automatic-rotation default');
assert.match(viewportModule, /originalAutoRotateSpeed/, 'Disabling poster mode restores the viewer automatic rotation speed');
assert.match(viewportModule, /orbitControls\.autoRotate = originalAutoRotate/, 'Disabling poster mode restores the viewer automatic-rotation enabled state');
console.log('Poster viewport geometry and Studio renderer-host tests passed.');

assert.match(viewportModule, /rendererCanvas\.style, \{[\s\S]*?left: layout\.left \+ 'px'[\s\S]*?width: layout\.width \+ 'px'[\s\S]*?height: layout\.height \+ 'px'/,
  'Studio WebGL canvas must occupy the actual poster artboard instead of being clipped from a full-size editor canvas');
assert.match(viewportModule, /if \(renderer\?\.setSize\) renderer\.setSize\(layout\.width, layout\.height, false\)/,
  'Studio renderer drawing buffer must be resized to the poster artboard dimensions');
assert.match(viewportModule, /activeCamera\.aspect = layout\.aspectRatio/,
  'Studio camera frustum must match the poster artboard aspect ratio');
assert.match(viewportModule, /renderer\?\.setSize\?\.\(width, height, false\)/,
  'Leaving poster mode must restore the normal full Studio renderer size');

assert.match(viewportModule, /zIndex: '9', pointerEvents: 'none'/,
  'The editorial poster canvas must sit above the supporting-image hit layer while remaining transparent to pointer events outside text items');
