/**
 * The camera-body label follows the hinge in position and orientation.
 * Run: node tests/browser/articulated-hotspot.browser.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.FUMOCA_BASE || 'http://127.0.0.1:8766';
const OUT = process.env.FUMOCA_ARTIFACTS || '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE + '/viewer.html?embed=1&localNif=/demo/records/antique-camera.json', { waitUntil: 'domcontentloaded', timeout: 60000 });
const label = page.locator('#fumocaPartHotspot');
await label.waitFor({ state: 'visible', timeout: 60000 });
await page.waitForFunction(() => window.FumocaMaster?.gesturesIdle?.());
async function read() {
  return label.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      text: el.textContent,
      x: r.x, y: r.y,
      wx: Number(el.dataset.wx), wy: Number(el.dataset.wy), wz: Number(el.dataset.wz),
      qx: Number(el.dataset.qx), qy: Number(el.dataset.qy), qz: Number(el.dataset.qz), qw: Number(el.dataset.qw),
    };
  });
}
const closed = await read();
if (!/camera body/i.test(closed.text)) throw new Error('Label is not on the camera body: ' + closed.text);
await page.screenshot({ path: join(OUT, 'viewer-hotspot-closed.png') });
await page.click('#fumocaLiveBar button');
await page.waitForFunction(() => window.FumocaMaster?.gesturesIdle?.(), null, { timeout: 5000 });
const open = await read();
await page.screenshot({ path: join(OUT, 'viewer-hotspot-open.png') });
const moved = Math.hypot(open.wx - closed.wx, open.wy - closed.wy, open.wz - closed.wz);
const screen = Math.hypot(open.x - closed.x, open.y - closed.y);
const qDelta = Math.hypot(open.qx - closed.qx, open.qy - closed.qy, open.qz - closed.qz, open.qw - closed.qw);
if (moved < 1e-3) throw new Error('Hotspot world position did not follow the hinge');
if (screen < 2) throw new Error('Hotspot screen position did not move');
if (qDelta < 1e-3) throw new Error('Hotspot orientation did not follow the hinge');
await browser.close();
console.log('Hotspot browser proof passed');
