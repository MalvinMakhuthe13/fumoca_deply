/**
 * Browser check: hinged lid and dynamic bottle do not share a writer.
 * Run: node tests/browser/articulated-ownership.browser.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.FUMOCA_BASE || 'http://127.0.0.1:8766';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
await page.goto(BASE + '/tests/browser/ownership-harness.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__ownership, null, { timeout: 30000 });
const result = await page.evaluate(() => window.__ownership);
await browser.close();
if (!result.ok) throw new Error('Ownership browser check failed: ' + JSON.stringify(result) + ' ' + errors.join(';'));
console.log('Ownership browser proof passed');
