/**
 * Smooth press-to-open in the visitor viewer.
 * Run: node tests/browser/articulated-ease.browser.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.FUMOCA_BASE || 'http://127.0.0.1:8766';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.error('PAGE', err.message));

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
async function pose() {
  return page.evaluate(() => {
    const THREE = window.THREE;
    let node = null;
    window.scene.traverse(n => { if (n.name === 'camera') node = n; });
    node.updateWorldMatrix(true, true);
    const p = new THREE.Vector3();
    node.getWorldPosition(p);
    return { x: p.x, y: p.y, z: p.z };
  });
}
async function idle() {
  await page.waitForFunction(() => window.FumocaMaster?.gesturesIdle?.(), null, { timeout: 5000 });
}

await page.goto(BASE + '/viewer.html?embed=1&localNif=/demo/records/antique-camera.json', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#fumocaLiveBar button', { timeout: 60000 });
await idle();
const closed = await pose();
await page.click('#fumocaLiveBar button');
const opening = await page.locator('#fumocaLiveStatus').innerText();
if (!/opening/i.test(opening)) throw new Error('Status snapped instead of easing: ' + opening);
await page.waitForTimeout(120);
const mid = await page.evaluate(() => {
  const THREE = window.THREE;
  let node = null;
  window.scene.traverse(n => { if (n.name === 'camera') node = n; });
  node.updateWorldMatrix(true, true);
  const p = new THREE.Vector3();
  node.getWorldPosition(p);
  const g = window.FumocaMaster.getGesture(node.userData.fumocaObjectId, node.userData.fumocaComponentId);
  if (!g || g.done) throw new Error('Gesture finished before the reverse');
  document.querySelector('#fumocaLiveBar button').click();
  const next = window.FumocaMaster.getGesture(node.userData.fumocaObjectId, node.userData.fumocaComponentId);
  if (!next || Math.abs(next.from - g.value) > 1e-4) throw new Error('Reverse did not start from the current value');
  if (next.to >= g.to) throw new Error('Reverse did not head back toward closed');
  return { x: p.x, y: p.y, z: p.z };
});
if (dist(mid, closed) < 1e-3) throw new Error('No motion before the reverse');
await page.waitForTimeout(120);
const reversed = await pose();
if (dist(reversed, closed) >= dist(mid, closed)) throw new Error('Reverse did not move back toward closed');
await idle();
const settled = await pose();
if (dist(settled, closed) > 1e-3) throw new Error('Reverse did not settle closed');

await page.click('#fumocaLiveBar button');
await idle();
const open = await pose();
if (dist(open, closed) < 1e-3) throw new Error('Open pose matches closed');
if (dist(mid, open) < 1e-3) throw new Error('Mid pose already at the open end');
for (let i = 0; i < 20; i++) {
  await page.click('#fumocaLiveBar button');
  await idle();
  await page.click('#fumocaLiveBar button');
  await idle();
}
const after = await pose();
if (dist(after, open) > 1e-3) throw new Error('Open pose drifted after 20 cycles: ' + JSON.stringify(after));
await page.click('#fumocaLiveBar button');
await idle();
const closedAgain = await pose();
if (dist(closedAgain, closed) > 1e-3) throw new Error('Closed pose drifted');
await browser.close();
console.log('Ease browser proof passed');
