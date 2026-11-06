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
    { id:'fixed', name:'Fixed logo', src:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3Crect width="100" height="100" fill="red"/%3E%3C/svg%3E', x:0.5, y:0.5, width:0.25, sizeMode:'fixed', fixedWidthPx:200, visible:true },
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
  assert.equal(initial.root.width, 640, '4:5 poster should be letterboxed inside a 1000×800 host');
  assert.equal(initial.root.x, 180, 'poster should be centred horizontally');
  assert.equal(initial.fixedWidth, 200, 'fixed layer must retain its configured CSS-pixel width');
  assert.equal(initial.responsiveWidth, 320, 'responsive layer should use 50% of poster width');

  await page.mouse.move(500, 400);
  await page.mouse.down();
  await page.mouse.move(564, 400, { steps:4 });
  await page.mouse.up();
  const movedX = await page.evaluate(() => window.FumocaPoster.getState().composition.assets.images.find(x => x.id === 'fixed').x);
  assert.ok(Math.abs(movedX - 0.6) < 0.002, `drag should use 640px poster coordinates; got x=${movedX}`);

  await page.setViewportSize({ width:390, height:844 });
  await page.evaluate(() => window.FumocaPosterAssets.refresh());
  const mobile = await page.evaluate(() => ({
    fixed: document.querySelector('[data-poster-asset-id="fixed"]').getBoundingClientRect().width,
    responsive: document.querySelector('[data-poster-asset-id="responsive"]').getBoundingClientRect().width,
    root: (() => { const r=document.querySelector('[data-fumoca-poster-assets]').getBoundingClientRect(); return {width:r.width,height:r.height}; })()
  }));
  assert.equal(mobile.root.width, 390, 'mobile poster should fit the available host width');
  assert.equal(mobile.fixed, 200, 'fixed-pixel image should retain its size on mobile');
  assert.equal(mobile.responsive, 195, 'responsive image should scale with the mobile poster width');

  console.log('Browser test passed: letterboxed drag coordinates, fixed-pixel sizing and responsive sizing on desktop/mobile.');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
