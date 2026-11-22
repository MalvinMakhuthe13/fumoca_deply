/**
 * Real licensed GLBs through Studio and the visitor viewer.
 * Run: node tests/browser/articulated-asset.browser.mjs
 * Requires a local server on port 8766 and Playwright Chromium.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.FUMOCA_BASE || 'http://127.0.0.1:8766';
const OUT = process.env.FUMOCA_ARTIFACTS || '/opt/cursor/artifacts';
mkdirSync(OUT, { recursive: true });
mkdirSync('demo/records', { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

async function openStudio() {
  await page.addInitScript(() => {
    window.FUMOCA_FOUNDER_EMAILS = ['local-founder@fumoca.test'];
    const timer = setInterval(() => {
      document.getElementById('founderWall')?.remove();
    }, 100);
    window.__fumocaWallTimer = timer;
  });
  await page.goto(BASE + '/edit.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.FumocaGLBBind && window.FumocaAuthor && window.scene, null, { timeout: 30000 });
  await page.evaluate(() => document.getElementById('founderWall')?.remove());
}

function near(a, b, eps = 1e-3) { return Math.abs(a - b) < eps; }

async function loadGlb(file) {
  const marker = file.split('/').pop().replace(/\.glb$/i, '');
  await page.setInputFiles('#loadGlbFile', file);
  await page.waitForFunction((name) => {
    const list = window.FumocaObjectAnim?.list?.() || [];
    return list.some(o => (o.components || []).length > 1 && String(o.name || '').includes(name));
  }, marker, { timeout: 60000 });
}

await openStudio();
await page.click('#authorBtn');
await page.waitForSelector('#fumocaAuthorPanel', { state: 'visible' });
await loadGlb('demo/assets/AntiqueCamera.glb');

const pivot = await page.evaluate(() => {
  const THREE = window.THREE;
  let node = null;
  window.scene.traverse(n => { if (n.name === 'camera') node = n; });
  if (!node) return null;
  const box = new THREE.Box3().setFromObject(node);
  node.parent.updateWorldMatrix(true, false);
  const inv = node.parent.matrixWorld.clone().invert();
  const min = box.min.clone().applyMatrix4(inv);
  const max = box.max.clone().applyMatrix4(inv);
  return { x: (min.x + max.x) / 2, y: min.y, z: (min.z + max.z) / 2 };
});
if (!pivot) throw new Error('AntiqueCamera has no camera node');

await page.locator('#faComponents label', { hasText: 'camera' }).locator('input').check();
await page.fill('#faName', 'Camera body');
await page.selectOption('#faAxis', 'x');
await page.fill('#faPx', String(pivot.x));
await page.fill('#faPy', String(pivot.y));
await page.fill('#faPz', String(pivot.z));
await page.click('#faApplyJoint');
await page.fill('#faTime', '0');
await page.fill('#faValue', '0');
await page.click('#faKf');
await page.fill('#faTime', '2');
await page.fill('#faValue', String(Math.PI / 2));
await page.click('#faKf');

const sample = await page.evaluate(() => {
  const THREE = window.THREE;
  let cameraNode = null;
  let tripod = null;
  window.scene.traverse(n => {
    if (n.name === 'camera') cameraNode = n;
    if (n.name === 'tripod') tripod = n;
  });
  const objectId = cameraNode.userData.fumocaObjectId;
  const componentId = cameraNode.userData.fumocaComponentId;
  function grab(time) {
    const ev = window.FumocaMaster.evaluate(time);
    cameraNode.updateWorldMatrix(true, true);
    tripod.updateWorldMatrix(true, true);
    const cw = new THREE.Vector3();
    const tw = new THREE.Vector3();
    cameraNode.getWorldPosition(cw);
    tripod.getWorldPosition(tw);
    return {
      jointError: ev.objects[objectId][componentId].jointError || null,
      cam: { x: cameraNode.quaternion.x, y: cameraNode.quaternion.y, z: cameraNode.quaternion.z, w: cameraNode.quaternion.w, px: cw.x, py: cw.y, pz: cw.z },
      tripod: { x: tripod.quaternion.x, y: tripod.quaternion.y, z: tripod.quaternion.z, w: tripod.quaternion.w, px: tw.x, py: tw.y, pz: tw.z },
    };
  }
  const closed = grab(0);
  const open = grab(2);
  return { objectId, componentId, closed, open };
});
if (sample.closed.jointError || sample.open.jointError) throw new Error('jointError ' + (sample.closed.jointError || sample.open.jointError));
const moved = Math.hypot(sample.open.cam.px - sample.closed.cam.px, sample.open.cam.py - sample.closed.cam.py, sample.open.cam.pz - sample.closed.cam.pz);
if (moved < 1e-3) throw new Error('Camera body did not move when opened');
if (!near(sample.open.tripod.px, sample.closed.tripod.px, 1e-4) || !near(sample.open.tripod.w, sample.closed.tripod.w, 1e-4)) {
  throw new Error('Tripod moved when the camera body opened');
}

const live = page.locator('#fumocaLiveBar button[data-id]');
await live.first().waitFor({ state: 'visible' });
for (let i = 0; i < 20; i++) {
  await live.first().click();
  await page.waitForFunction(() => window.FumocaMaster?.gesturesIdle?.(), null, { timeout: 5000 });
}
const after = await page.evaluate((ids) => {
  const THREE = window.THREE;
  let cameraNode = null;
  let tripod = null;
  window.scene.traverse(n => {
    if (n.name === 'camera') cameraNode = n;
    if (n.name === 'tripod') tripod = n;
  });
  const closed = window.FumocaMaster.evaluate(0);
  cameraNode.updateWorldMatrix(true, true);
  const closedPos = new THREE.Vector3();
  cameraNode.getWorldPosition(closedPos);
  const open = window.FumocaMaster.evaluate(2);
  cameraNode.updateWorldMatrix(true, true);
  const openPos = new THREE.Vector3();
  cameraNode.getWorldPosition(openPos);
  tripod.updateWorldMatrix(true, true);
  const tw = new THREE.Vector3();
  tripod.getWorldPosition(tw);
  return {
    closedError: closed.objects[ids.objectId][ids.componentId].jointError || null,
    openError: open.objects[ids.objectId][ids.componentId].jointError || null,
    closedPos: { x: closedPos.x, y: closedPos.y, z: closedPos.z },
    openPos: { x: openPos.x, y: openPos.y, z: openPos.z },
    tripod: { x: tw.x, y: tw.y, z: tw.z, w: tripod.quaternion.w },
  };
}, sample);
if (after.closedError || after.openError) throw new Error('jointError after repeats');
if (!near(after.closedPos.x, sample.closed.cam.px) || !near(after.closedPos.y, sample.closed.cam.py) || !near(after.closedPos.z, sample.closed.cam.pz)) {
  throw new Error('Closed pose drifted: ' + JSON.stringify(after.closedPos));
}
if (!near(after.openPos.x, sample.open.cam.px) || !near(after.openPos.y, sample.open.cam.py) || !near(after.openPos.z, sample.open.cam.pz)) {
  throw new Error('Open pose drifted: ' + JSON.stringify(after.openPos));
}
if (!near(after.tripod.x, sample.closed.tripod.px, 1e-4) || !near(after.tripod.w, sample.closed.tripod.w, 1e-4)) {
  throw new Error('Tripod drifted');
}

await page.click('#faSave');
await page.waitForFunction(() => (document.getElementById('faStatus')?.textContent || '').includes('Saved'));
await page.screenshot({ path: join(OUT, 'studio-camera-open.png') });

const beforeReload = sample.open.cam;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.FumocaGLBBind && window.scene, null, { timeout: 30000 });
await page.evaluate(() => document.getElementById('founderWall')?.remove());
await loadGlb('demo/assets/AntiqueCamera.glb');
const reloaded = await page.evaluate(() => {
  const THREE = window.THREE;
  let cameraNode = null;
  let tripod = null;
  window.scene.traverse(n => {
    if (n.name === 'camera') cameraNode = n;
    if (n.name === 'tripod') tripod = n;
  });
  const objectId = cameraNode.userData.fumocaObjectId;
  const componentId = cameraNode.userData.fumocaComponentId;
  const obj = window.FumocaObjectAnim.get(objectId);
  const comp = obj.components.find(c => c.id === componentId);
  window.FumocaMaster.evaluate(2);
  cameraNode.updateWorldMatrix(true, true);
  const p = new THREE.Vector3();
  cameraNode.getWorldPosition(p);
  const ev = window.FumocaMaster.evaluate(2);
  return {
    name: comp.name,
    kind: comp.joint.kind,
    pivot: comp.joint.pivot,
    jointError: ev.objects[objectId][componentId].jointError || null,
    pos: { x: p.x, y: p.y, z: p.z },
  };
});
if (reloaded.name !== 'Camera body' || reloaded.kind !== 'hinge') throw new Error('Reload lost the hinge: ' + JSON.stringify(reloaded));
if (Math.hypot(reloaded.pivot.x, reloaded.pivot.y, reloaded.pivot.z) < 1e-6) throw new Error('Reload lost the pivot');
if (reloaded.jointError) throw new Error('jointError after reload');
if (!near(reloaded.pos.x, beforeReload.px) || !near(reloaded.pos.y, beforeReload.py) || !near(reloaded.pos.z, beforeReload.pz)) {
  throw new Error('Reloaded open pose differs: ' + JSON.stringify(reloaded.pos));
}

await loadGlb('demo/assets/Lantern.glb');
const lanternPivot = await page.evaluate(() => {
  const THREE = window.THREE;
  let node = null;
  window.scene.traverse(n => { if (n.name === 'LanternPole_Lantern') node = n; });
  const box = new THREE.Box3().setFromObject(node);
  node.parent.updateWorldMatrix(true, false);
  const inv = node.parent.matrixWorld.clone().invert();
  const min = box.min.clone().applyMatrix4(inv);
  const max = box.max.clone().applyMatrix4(inv);
  return { x: (min.x + max.x) / 2, y: min.y, z: (min.z + max.z) / 2 };
});
await page.locator('#faComponents label', { hasText: 'LanternPole_Lantern' }).locator('input').check();
await page.fill('#faName', 'Lamp head');
await page.selectOption('#faAxis', 'z');
await page.fill('#faPx', String(lanternPivot.x));
await page.fill('#faPy', String(lanternPivot.y));
await page.fill('#faPz', String(lanternPivot.z));
await page.click('#faApplyJoint');
await page.fill('#faTime', '0');
await page.fill('#faValue', '0');
await page.click('#faKf');
await page.fill('#faTime', '2');
await page.fill('#faValue', String(Math.PI / 5));
await page.click('#faKf');
const lantern = await page.evaluate(() => {
  const THREE = window.THREE;
  let head = null;
  let pole = null;
  window.scene.traverse(n => {
    if (n.name === 'LanternPole_Lantern') head = n;
    if (n.name === 'LanternPole_Body') pole = n;
  });
  const id = head.userData.fumocaObjectId;
  const cid = head.userData.fumocaComponentId;
  function at(t) {
    const ev = window.FumocaMaster.evaluate(t);
    head.updateWorldMatrix(true, true);
    pole.updateWorldMatrix(true, true);
    const hp = new THREE.Vector3();
    const pp = new THREE.Vector3();
    head.getWorldPosition(hp);
    pole.getWorldPosition(pp);
    return { err: ev.objects[id][cid].jointError || null, hx: hp.x, hy: hp.y, hz: hp.z, px: pp.x, py: pp.y, pz: pp.z };
  }
  return { closed: at(0), open: at(2) };
});
if (lantern.closed.err || lantern.open.err) throw new Error('Lantern jointError');
const lampMoved = Math.hypot(lantern.open.hx - lantern.closed.hx, lantern.open.hy - lantern.closed.hy, lantern.open.hz - lantern.closed.hz);
if (lampMoved < 1e-3) throw new Error('Lamp head did not move');
if (!near(lantern.open.px, lantern.closed.px, 1e-4) || !near(lantern.open.py, lantern.closed.py, 1e-4)) throw new Error('Lantern pole moved');
await page.screenshot({ path: join(OUT, 'studio-lantern.png') });

const record = await page.evaluate(() => {
  const saved = JSON.parse(sessionStorage.getItem('fumoca:preparedAnim'));
  return saved;
});
const timeline = record.timeline;
timeline.objects = (timeline.objects || []).filter(o => o.id === record.objectId);
const localNif = {
  id: 'local-antique-camera',
  title: 'Antique camera',
  description: 'Press Camera body. The tripod stays put.',
  status: 'done',
  meta: {
    demo_glb: '/demo/assets/AntiqueCamera.glb',
    prepared_object_id: record.objectId,
    anim_timeline: timeline,
    local_only: true,
    license: 'AntiqueCamera.glb is CC0. Source: Khronos glTF-Sample-Assets, UX3D.',
  },
};
writeFileSync('demo/records/antique-camera.json', JSON.stringify(localNif, null, 2));

const viewer = await context.newPage();
viewer.on('pageerror', (err) => errors.push('viewer ' + err));
await viewer.goto(BASE + '/viewer.html?embed=1&localNif=/demo/records/antique-camera.json', { waitUntil: 'domcontentloaded', timeout: 60000 });
await viewer.waitForSelector('#fumocaLiveBar button', { timeout: 60000 });
const visitorClosed = await viewer.evaluate(() => {
  const THREE = window.THREE;
  let node = null;
  window.scene.traverse(n => { if (n.name === 'camera') node = n; });
  window.FumocaMaster.evaluate(0);
  node.updateWorldMatrix(true, true);
  const p = new THREE.Vector3();
  node.getWorldPosition(p);
  return { x: p.x, y: p.y, z: p.z };
});
await viewer.click('#fumocaLiveBar button');
await viewer.waitForTimeout(200);
const visitorOpen = await viewer.evaluate(() => {
  const THREE = window.THREE;
  let node = null;
  let tripod = null;
  window.scene.traverse(n => {
    if (n.name === 'camera') node = n;
    if (n.name === 'tripod') tripod = n;
  });
  node.updateWorldMatrix(true, true);
  tripod.updateWorldMatrix(true, true);
  const p = new THREE.Vector3();
  const t = new THREE.Vector3();
  node.getWorldPosition(p);
  tripod.getWorldPosition(t);
  const id = node.userData.fumocaObjectId;
  const cid = node.userData.fumocaComponentId;
  const ev = window.FumocaMaster.evaluate(2);
  return {
    x: p.x, y: p.y, z: p.z,
    tx: t.x, ty: t.y, tz: t.z,
    jointError: ev.objects[id][cid].jointError || null,
  };
});
if (visitorOpen.jointError) throw new Error('Viewer jointError');
if (Math.hypot(visitorOpen.x - visitorClosed.x, visitorOpen.y - visitorClosed.y, visitorOpen.z - visitorClosed.z) < 1e-3) {
  throw new Error('Viewer toggle did not move the camera body');
}
await viewer.screenshot({ path: join(OUT, 'viewer-camera-open.png') });
await viewer.click('#fumocaLiveBar button');
await viewer.waitForTimeout(200);
const visitorBack = await viewer.evaluate(() => {
  const THREE = window.THREE;
  let node = null;
  window.scene.traverse(n => { if (n.name === 'camera') node = n; });
  node.updateWorldMatrix(true, true);
  const p = new THREE.Vector3();
  node.getWorldPosition(p);
  return { x: p.x, y: p.y, z: p.z };
});
if (!near(visitorBack.x, visitorClosed.x) || !near(visitorBack.y, visitorClosed.y) || !near(visitorBack.z, visitorClosed.z)) {
  throw new Error('Viewer close did not restore the pose');
}
await viewer.screenshot({ path: join(OUT, 'viewer-camera-closed.png') });

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const phone = await mobile.newPage();
await phone.goto(BASE + '/demo/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
const frame = phone.frameLocator('iframe');
await frame.locator('#fumocaLiveBar button').waitFor({ state: 'visible', timeout: 60000 });
await frame.locator('#fumocaLiveBar button').click();
await phone.screenshot({ path: join(OUT, 'demo-phone.png') });
await mobile.close();

await page.close();
await viewer.close();
await context.close();
await browser.close();

const fatal = errors.filter(e => !/favicon|supabase|Failed to load resource|net::ERR|config\.js|Spark|gaussian|WebGL|THREE.WebGLRenderer/i.test(e));
if (fatal.length) {
  console.error(fatal.slice(0, 12).join('\n'));
  throw new Error('Page errors: ' + fatal.length);
}
console.log('Browser articulation proof passed');
console.log('Screenshots:', OUT);
