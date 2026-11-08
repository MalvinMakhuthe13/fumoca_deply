import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { chromium } from 'playwright';

const moduleSource = await readFile(new URL('../../js/modules/poster-assets.js', import.meta.url), 'utf8');
const fixture = `<!doctype html>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body { margin:0; width:100%; height:100%; background:#111; }
  #viewport { position:relative; width:100%; height:100%; overflow:hidden; }
</style>
<div id="viewport"></div>
<script>
  const composition = { aspectRatio: 0.8, assets: { images: [
    { id:'fixed', name:'Fixed logo', src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="red"/%3E%3C/svg%3E', x:0.5, y:0.5, width:0.25, sizeMode:'fixed', fixedWidthPx:200, anchor:'top-right', visible:true },
    { id:'responsive', name:'Responsive logo', src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="blue"/%3E%3C/svg%3E', x:0.2, y:0.2, width:0.5, sizeMode:'responsive', minWidthPx:72, maxWidthPx:720, visible:true }
  ] } };
  window.FumocaPoster = {
    getState: () => ({ enabled:true, composition }),
    updateComposition(patch) {
      if (patch.assets) composition.assets = { ...composition.assets, ...patch.assets };
      window.dispatchEvent(new CustomEvent('fumoca:posterChange'));
    }
  };
</script>
<script type="module" src="/poster-assets.js"></script>`;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/edit.html') { res.writeHead(200, {'content-type':'text/html'}); res.end(fixture); return; }
  if (req.url === '/poster-assets.js') { res.writeHead(200, {'content-type':'text/javascript'}); res.end(moduleSource); return; }
  res.writeHead(404); res.end('not found');
});
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
server.listen(port, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));

let browser;
try {
  browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:1000, height:800 } });
  await page.goto(`http://127.0.0.1:${port}/edit.html`);
  await page.waitForSelector('[data-poster-asset-id="fixed"]');

  const initial = await page.evaluate(() => {
    const root = document.querySelector('[data-fumoca-poster-assets]');
    const fixed = document.querySelector('[data-poster-asset-id="fixed"]');
    const responsive = document.querySelector('[data-poster-asset-id="responsive"]');
    return {
      root: (() => { const r=root.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })(),
      fixedWidth: fixed.getBoundingClientRect().width,
      responsiveWidth: responsive.getBoundingClientRect().width
    };
  });
  // The assets root fills the selected host. Letterboxing is the viewport
  // module's job; this test verifies that interactions use the host's own
  // coordinate system and that fixed/responsive sizing still works.
  assert.equal(initial.root.width, 1000, 'supporting images must fill the selected host width');
  assert.equal(initial.root.x, 0, 'supporting images must share the host origin');
  assert.equal(initial.fixedWidth, 200, 'fixed layer must retain its configured CSS-pixel width');
  assert.equal(initial.responsiveWidth, 500, 'responsive layer should use 50% of the host width');

  await page.mouse.move(400, 400);
  await page.mouse.down();
  await page.mouse.move(464, 400, { steps:4 });
  await page.mouse.up();
  const moved = await page.evaluate(() => window.FumocaPoster.getState().composition.assets.images.find(x => x.id === 'fixed'));
  assert.equal(moved.anchor, 'free', 'dragging a top-right anchored image must switch it to a free centre anchor');
  assert.ok(Math.abs(moved.x - 0.464) < 0.002, `drag should preserve the rendered centre and use 1000px host coordinates; got x=${moved.x}`);

  await page.locator('[data-poster-asset-id="fixed"]').click();
  const rotateHandle = page.getByRole('button', { name: 'Rotate Fixed logo' });
  await rotateHandle.waitFor();
  const handleBox = await rotateHandle.boundingBox();
  assert.ok(handleBox, 'selected image should expose a visible rotation handle');
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(524, 400, { steps:5 });
  await page.mouse.up();
  const rotation = await page.evaluate(() => window.FumocaPoster.getState().composition.assets.images.find(x => x.id === 'fixed').rotation);
  assert.ok(Math.abs(rotation) > 20, `rotation handle should update the image rotation; got ${rotation}`);

  const resizeHandle = page.getByRole('button', { name: 'Resize Fixed logo' });
  const resizeBox = await resizeHandle.boundingBox();
  assert.ok(resizeBox, 'selected image should expose a visible resize handle');
  await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 1400, resizeBox.y + resizeBox.height / 2, { steps: 8 });
  await page.mouse.up();
  const resized = await page.evaluate(() => {
    const layer = document.querySelector('[data-poster-asset-id="fixed"]');
    const root = document.querySelector('[data-fumoca-poster-assets]');
    const a = layer.getBoundingClientRect(), b = root.getBoundingClientRect();
    return { width: a.width, left: a.left, right: a.right, rootLeft: b.left, rootRight: b.right };
  });
  assert.ok(resized.width <= 1000, 'resizing must never create a fixed-pixel image wider than the poster artboard');
  assert.ok(resized.left >= resized.rootLeft - 1 && resized.right <= resized.rootRight + 1, 'resized image must remain inside the poster artboard');

  await page.setViewportSize({ width:390, height:844 });
  await page.evaluate(() => window.FumocaPosterAssets.refresh());
  const mobile = await page.evaluate(() => ({
    fixed: document.querySelector('[data-poster-asset-id="fixed"]').getBoundingClientRect().width,
    savedFixed: window.FumocaPoster.getState().composition.assets.images.find(x => x.id === 'fixed').fixedWidthPx,
    responsive: document.querySelector('[data-poster-asset-id="responsive"]').getBoundingClientRect().width,
    root: (() => { const r=document.querySelector('[data-fumoca-poster-assets]').getBoundingClientRect(); return {width:r.width,height:r.height}; })()
  }));
  assert.equal(mobile.root.width, 390, 'supporting images must fill the resized host width');
  assert.equal(mobile.fixed, resized.width, 'fixed-pixel image should retain its resized desktop CSS-pixel width on mobile');
  assert.equal(mobile.fixed, mobile.savedFixed, 'fixed-pixel rendering must match the persisted fixed width');
  assert.equal(mobile.responsive, 195, 'responsive image should scale with the host width');

  console.log('Browser test passed: host-filling coordinates, fixed-pixel sizing, direct image rotation and responsive sizing on desktop/mobile.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
