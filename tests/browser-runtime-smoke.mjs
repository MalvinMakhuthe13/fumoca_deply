import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

const port = 8765;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  stdio: 'ignore',
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/tests/browser-runtime-smoke.html`);
      if (response.ok) { ready = true; break; }
    } catch { /* server is starting */ }
    await delay(250);
  }
  assert.ok(ready, 'local static server did not become ready');
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/tests/browser-runtime-smoke.html`, { waitUntil: 'load' });
  await page.getByRole('button', { name: 'Run browser conversion checks' }).click();
  await page.waitForFunction(() => window.__browserTestResult?.ok === true || window.__browserTestResult?.ok === false);
  const result = await page.evaluate(() => window.__browserTestResult);
  assert.equal(result.ok, true, result.error || 'browser conversion harness failed');
  assert.equal(result.points, 2);
  assert.equal(result.shCoefficients, 24);
  assert.deepEqual(pageErrors, [], 'browser runtime must not throw unhandled page errors');
  console.log('Browser runtime NIF/SPLAT/Gaussian-SH round-trip passed:', result);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
