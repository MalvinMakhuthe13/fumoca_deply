/**
 * Client landing: loads, then switches to the second object.
 * Run: node tests/browser/demo-landing.browser.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';
const BASE = process.env.FUMOCA_BASE || 'http://127.0.0.1:8766';
const OUT = process.env.FUMOCA_ARTIFACTS || '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(BASE + '/demo/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
const frame = page.frameLocator('iframe');
await frame.locator('#fumocaPartHotspot').waitFor({ state: 'visible', timeout: 60000 });
await page.screenshot({ path: join(OUT, 'demo-phone.png') });
const desc = await page.locator('meta[name="description"]').getAttribute('content');
if (!desc || !/tripod/i.test(desc)) throw new Error('Missing share description');
await page.click('#pickLantern');
await page.locator('#loading').waitFor({ state: 'visible' });
await frame.locator('#fumocaLiveBar button', { hasText: 'Lamp head' }).waitFor({ state: 'visible', timeout: 60000 });
await page.screenshot({ path: join(OUT, 'demo-phone-lantern.png') });
await browser.close();
console.log('Demo landing browser proof passed');
