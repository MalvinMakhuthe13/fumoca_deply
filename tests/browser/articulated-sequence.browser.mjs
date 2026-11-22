/**
 * Browser check for an ordered two-part sequence on the master clock.
 * Run: node tests/browser/articulated-sequence.browser.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.FUMOCA_BASE || 'http://127.0.0.1:8766';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(BASE + '/tests/browser/sequence-harness.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__sequence, null, { timeout: 15000 });
const result = await page.evaluate(() => window.__sequence);
await browser.close();
if (!result.ok) throw new Error(JSON.stringify(result));
console.log('Sequence browser proof passed');
