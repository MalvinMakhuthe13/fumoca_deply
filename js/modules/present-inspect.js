/**
 * Full-screen inspect: from a poster / magazine cover / newspaper, take the
 * object out of the layout and fill the screen with it to turn it round and
 * zoom in close — then go back to the layout exactly as it was.
 * Works in Studio's Present preview and on the published page.
 */

function cam() { return { camera: window._fumocaViewerCamera || window.camera || window._fumocaCamera, controls: window._fumocaViewerControls || window.controls || window._fumocaControls }; }

const state = { active: false, saved: null, bar: null, btn: null };

function layoutOn() { return !!window.FumocaPoster?.getState?.()?.enabled; }

function textLayers() { return [...document.querySelectorAll('#magazineTextLayer, .mt-layer')]; }

export function enter() {
  if (state.active) return;
  const { camera, controls } = cam();
  state.saved = {
    poster: layoutOn(),
    cam: camera ? { p: camera.position.toArray(), q: camera.quaternion.toArray(), fov: camera.fov, zoom: camera.zoom } : null,
    target: controls?.target ? controls.target.toArray() : null,
    limits: controls ? { minDistance: controls.minDistance, maxDistance: controls.maxDistance, enablePan: controls.enablePan, enableZoom: controls.enableZoom, enableRotate: controls.enableRotate } : null,
    text: textLayers().map(el => [el, el.style.visibility]),
  };
  state.active = true;
  try { if (state.saved.poster) window.FumocaPoster.setEnabled(false); } catch (_) {}
  for (const [el] of state.saved.text) el.style.visibility = 'hidden';
  window.FumocaFilters?.layer?.()?.suspend?.(true);
  if (controls) {
    // inspecting: allow getting really close and all the way round
    controls.enableRotate = true; controls.enableZoom = true; controls.enablePan = true;
    controls.minDistance = Math.min(controls.minDistance ?? 0.01, 0.02);
    controls.maxDistance = Math.max(controls.maxDistance ?? 100, 50);
  }
  document.documentElement.classList.add('fumoca-inspecting');
  try { if (document.fullscreenEnabled && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {}); } catch (_) {}
  showBar(true);
  window.dispatchEvent(new CustomEvent('fumoca:inspect', { detail: { active: true } }));
}

export function exit() {
  if (!state.active) return;
  const { camera, controls } = cam(), s = state.saved || {};
  state.active = false;
  try { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); } catch (_) {}
  if (controls && s.limits) Object.assign(controls, s.limits);
  if (camera && s.cam) {
    camera.position.fromArray(s.cam.p); camera.quaternion.fromArray(s.cam.q);
    if (s.cam.fov) camera.fov = s.cam.fov; if (s.cam.zoom) camera.zoom = s.cam.zoom; camera.updateProjectionMatrix?.();
  }
  if (controls?.target && s.target) { controls.target.fromArray(s.target); controls.update?.(); }
  try { if (s.poster) window.FumocaPoster.setEnabled(true); } catch (_) {}
  for (const [el, v] of s.text || []) el.style.visibility = v || '';
  window.FumocaFilters?.layer?.()?.suspend?.(false);
  document.documentElement.classList.remove('fumoca-inspecting');
  showBar(false);
  window.dispatchEvent(new CustomEvent('fumoca:inspect', { detail: { active: false } }));
}

function showBar(on) {
  if (!state.bar) {
    const b = document.createElement('div');
    b.className = 'fumoca-inspect-bar';
    b.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483000;display:none;gap:8px;align-items:center;padding:8px 10px;border-radius:999px;background:rgba(5,7,11,.82);border:1px solid rgba(255,255,255,.14);color:#fff;font:600 13px/1 "DM Sans",system-ui,sans-serif;backdrop-filter:blur(10px)';
    b.innerHTML = '<span style="opacity:.75;padding:0 6px">Drag to turn · pinch / scroll to zoom</span><button type="button" style="border:0;border-radius:999px;padding:9px 14px;background:#c8ff00;color:#10131a;font:800 13px/1 inherit;cursor:pointer">← Back to the layout</button>';
    b.querySelector('button').addEventListener('click', exit);
    document.body.appendChild(b);
    state.bar = b;
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.active) exit(); });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && state.active && state.leftFs) exit(); state.leftFs = !!document.fullscreenElement; });
  }
  state.bar.style.display = on ? 'flex' : 'none';
  if (state.btn) state.btn.style.display = on ? 'none' : (layoutOn() ? 'flex' : 'none');
}

/** A floating "Inspect" button, shown while a layout (poster / cover / newspaper) is on. */
export function mountButton() {
  if (state.btn) return state.btn;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'fumoca-inspect-btn';
  b.title = 'Take the object out of the layout and inspect it full screen';
  b.textContent = '⛶ Inspect';
  b.style.cssText = 'position:fixed;right:16px;top:16px;z-index:2147482000;display:none;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:9px 14px;background:rgba(5,7,11,.78);color:#fff;font:700 13px/1 "DM Sans",system-ui,sans-serif;cursor:pointer;backdrop-filter:blur(8px)';
  b.addEventListener('click', enter);
  document.body.appendChild(b);
  state.btn = b;
  const sync = () => { if (!state.active) b.style.display = layoutOn() ? 'flex' : 'none'; };
  window.addEventListener('fumoca:posterChange', sync);
  setTimeout(sync, 500);
  return b;
}

const api = { enter, exit, mountButton, get active() { return state.active; } };
if (typeof window !== 'undefined') window.FumocaInspect = api;
export default api;
