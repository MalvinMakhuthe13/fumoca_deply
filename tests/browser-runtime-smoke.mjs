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

  // A second, actual Studio page smoke: load a tiny local SPLAT through the
  // file picker and verify it becomes a detached local editor session.
  const studio = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const studioErrors = [];
  studio.on('pageerror', error => studioErrors.push(error.message));
  await studio.goto(`http://127.0.0.1:${port}/edit.html`, { waitUntil: 'domcontentloaded' });
  await studio.locator('#fileInput').waitFor({ state: 'attached' });
  const fixture = Buffer.alloc(32);
  const fixtureView = new DataView(fixture.buffer, fixture.byteOffset, fixture.byteLength);
  fixtureView.setFloat32(0, 0.25, true);
  fixtureView.setFloat32(4, -0.5, true);
  fixtureView.setFloat32(8, 1.5, true);
  fixtureView.setFloat32(12, 0.1, true);
  fixtureView.setFloat32(16, 0.2, true);
  fixtureView.setFloat32(20, 0.3, true);
  fixture[24] = 220; fixture[25] = 120; fixture[26] = 40; fixture[27] = 230;
  fixture[28] = 255; fixture[29] = 128; fixture[30] = 128; fixture[31] = 128;
  await studio.locator('#fileInput').setInputFiles({
    name: 'browser-studio-fixture.splat',
    mimeType: 'application/octet-stream',
    buffer: fixture,
  });
  await studio.waitForFunction(() => window.S?.alive?.length === 1 && window.S?.positions?.length === 3, null, { timeout: 30000 });
  const studioState = await studio.evaluate(() => ({
    pointCount: window.S.alive.length,
    loadedFromRecord: window._fumocaLoadedFromRecord,
    canonicalNifUrl: window._fumocanifUrl,
    exportEnabled: document.getElementById('exportNifBtn')?.disabled === false,
  }));
  assert.equal(studioState.pointCount, 1);
  assert.equal(studioState.loadedFromRecord, false, 'local file import must detach the previous record context');
  assert.equal(studioState.canonicalNifUrl, '', 'local file import must clear stale canonical viewer URLs');
  assert.equal(studioState.exportEnabled, true, 'NIF export must be enabled after a valid local SPLAT loads');
  assert.deepEqual(studioErrors, [], 'Studio local-file load must not throw browser runtime errors');
  console.log('Studio browser file-load smoke passed:', studioState);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
