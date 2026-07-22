window._fumocaUseHotspotPro = true;

import * as THREE from 'three';
import { renderActionButtons } from './hotspot-actions.js';

const hotspotLayer = document.getElementById('hotspotLayer');
const hotspotBtn = document.getElementById('hotspotBtn');
const hotspotPanel = document.getElementById('hotspotProPanel');
const hotspotInfoCard = document.getElementById('hotspotInfoCard');
const nestedOverlay = document.getElementById('nestedSplatOverlay');
const nestedFrame = document.getElementById('nestedSplatFrame');
const nestedMeta = document.getElementById('nestedSplatMeta');
const nestedTitle = document.getElementById('nestedSplatTitle');
const nestedSub = document.getElementById('nestedSplatSub');
const nestedOpenNew = document.getElementById('nestedSplatOpenNew');
const nestedClose = document.getElementById('nestedSplatClose');


const pointCloudCache = {
  url: '',
  loaded: false,
  loading: null,
  positions: null,
  count: 0,
  stride: 1,
  boundsCenter: null,
  boundsRadius: 0,
};

function _sampleStride(count) {
  return Math.max(1, Math.ceil(count / 24000));
}

function _parseSplatPositions(buf) {
  const row = 32;
  const count = Math.floor(buf.byteLength / row);
  const stride = _sampleStride(count);
  const view = new DataView(buf);
  const out = [];
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < count; i += stride) {
    const b = i * row;
    const x = view.getFloat32(b, true);
    const y = view.getFloat32(b + 4, true);
    const z = view.getFloat32(b + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out.push(x, y, z);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const center = new THREE.Vector3((x0 + x1) / 2 || 0, (y0 + y1) / 2 || 0, (z0 + z1) / 2 || 0);
  const radius = Math.max(0.5, center.distanceTo(new THREE.Vector3(x1 || 0, y1 || 0, z1 || 0)));
  return { positions: new Float32Array(out), count: out.length / 3, stride, center, radius };
}

function _parsePlyPositions(buf) {
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder('ascii');
  const marker = 'end_header\n';
  let hdrEnd = -1;
  for (let i = 0; i < bytes.length - marker.length; i++) {
    if (dec.decode(bytes.slice(i, i + marker.length)) === marker) {
      hdrEnd = i + marker.length;
      break;
    }
  }
  if (hdrEnd < 0) return null;
  const hdr = dec.decode(bytes.slice(0, hdrEnd));
  const lines = hdr.split('\n');
  let N = 0;
  const props = [];
  const typeSz = { float: 4, double: 8, uchar: 1, int: 4 };
  for (const ln of lines) {
    const me = ln.match(/^element vertex (\d+)/);
    if (me) N = parseInt(me[1], 10);
    const mp = ln.match(/^property (float|double|uchar|int) (\w+)/);
    if (mp) props.push({ type: mp[1], name: mp[2] });
  }
  if (!N) return null;
  let rowSz = 0;
  const offsets = {};
  for (const prop of props) { offsets[prop.name] = rowSz; rowSz += typeSz[prop.type] || 4; }
  const data = new DataView(buf, hdrEnd);
  const stride = _sampleStride(N);
  const out = [];
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < N; i += stride) {
    const base = i * rowSz;
    const x = data.getFloat32(base + (offsets.x || 0), true);
    const y = data.getFloat32(base + (offsets.y || 4), true);
    const z = data.getFloat32(base + (offsets.z || 8), true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    out.push(x, y, z);
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const center = new THREE.Vector3((x0 + x1) / 2 || 0, (y0 + y1) / 2 || 0, (z0 + z1) / 2 || 0);
  const radius = Math.max(0.5, center.distanceTo(new THREE.Vector3(x1 || 0, y1 || 0, z1 || 0)));
  return { positions: new Float32Array(out), count: out.length / 3, stride, center, radius };
}

async function ensurePointCloudCache() {
  // In edit.html, read positions directly from window.S (already loaded, no fetch needed)
  if (window.S?.positions?.length && !pointCloudCache.loaded) {
    const pos = window.S.positions;
    const alive = window.S.alive;
    const out = [];
    let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;
    for (let i=0; i<(alive?.length||pos.length/3); i++) {
      if (alive && !alive[i]) continue;
      const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2];
      if (!isFinite(x)||!isFinite(y)||!isFinite(z)) continue;
      out.push(x,y,z);
      if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;if(z<z0)z0=z;if(z>z1)z1=z;
    }
    pointCloudCache.positions = new Float32Array(out);
    pointCloudCache.count = out.length/3;
    pointCloudCache.boundsCenter = new THREE.Vector3((x0+x1)/2,(y0+y1)/2,(z0+z1)/2);
    pointCloudCache.boundsRadius = Math.max(0.5, Math.sqrt(((x1-x0)**2+(y1-y0)**2+(z1-z0)**2)/4));
    pointCloudCache.loaded = true;
    pointCloudCache.url = 'editor_live';
    return pointCloudCache;
  }

  const url = window._fumocaViewer?.fileUrl || window._fumocaSplatUrl || '';
  if (!url) return null;
  if (pointCloudCache.loaded && pointCloudCache.url === url) return pointCloudCache;
  if (pointCloudCache.loading && pointCloudCache.url === url) return pointCloudCache.loading;
  pointCloudCache.url = url;
  pointCloudCache.loading = (async () => {
    try {
      if (window._editEngine?.getPointCloud) {
        const local = window._editEngine.getPointCloud();
        if (local?.positions?.length) {
          pointCloudCache.positions = local.positions;
          pointCloudCache.count = local.count || (local.positions.length / 3);
          pointCloudCache.boundsCenter = local.center ? new THREE.Vector3(local.center.x, local.center.y, local.center.z) : null;
          pointCloudCache.boundsRadius = Number(local.radius || 0);
          pointCloudCache.loaded = true;
          return pointCloudCache;
        }
      }
    } catch (_) {}
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      const lower = url.toLowerCase();
      const parsed = lower.includes('.ply') ? _parsePlyPositions(buf) : _parseSplatPositions(buf);
      if (parsed?.positions?.length) {
        pointCloudCache.positions = parsed.positions;
        pointCloudCache.count = parsed.count;
        pointCloudCache.stride = parsed.stride;
        pointCloudCache.boundsCenter = parsed.center;
        pointCloudCache.boundsRadius = parsed.radius;
        pointCloudCache.loaded = true;
      }
    } catch (err) {
      console.warn('[hotspot-pro] point cloud cache load failed', err);
    }
    return pointCloudCache;
  })();
  return pointCloudCache.loading;
}

function pickPrecisePointOnSplat(ray, fallbackTarget) {
  const cache = pointCloudCache;
  if (!ray || !cache?.positions?.length) return null;
  const pos = cache.positions;
  const nearest = new THREE.Vector3();
  let bestScore = Infinity;
  let bestDepth = Infinity;
  const maxRadius = Math.max(0.12, (cache.boundsRadius || 1) * 0.06);
  for (let i = 0; i < pos.length; i += 3) {
    nearest.set(pos[i], pos[i + 1], pos[i + 2]);
    const depth = ray.direction.dot(nearest.clone().sub(ray.origin));
    if (depth <= 0) continue;
    const pointOnRay = ray.origin.clone().add(ray.direction.clone().multiplyScalar(depth));
    const dist = pointOnRay.distanceTo(nearest);
    if (dist > maxRadius) continue;
    const targetPenalty = fallbackTarget ? nearest.distanceTo(fallbackTarget) * 0.06 : 0;
    const score = dist + targetPenalty + depth * 0.0008;
    if (score < bestScore || (Math.abs(score - bestScore) < 1e-6 && depth < bestDepth)) {
      bestScore = score;
      bestDepth = depth;
    }
  }
  if (!Number.isFinite(bestScore)) return null;
  return ray.origin.clone().add(ray.direction.clone().multiplyScalar(bestDepth));
}

const state = {
  hotspots: [],
  activeId: null,
  canManage: false,
  loaded: false,
  saving: false,
  tourIndex: -1,
  worldProjectionEnabled: false,
  tourActive: false,
  tourTimer: null,
  tourDelay: 2800,
  activeAudio: null,
  overlayUrl: '',
};

function uid() {
  return 'hs_' + Math.random().toString(36).slice(2, 10);
}

function track(name, detail = {}) {
  try { window._fumocaTrack?.(name, detail); } catch (_) {}
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localKey() {
  const rec = window._fumocaCurrentRecord || {};
  return `fumoca_hotspots_${rec.id || location.pathname}`;
}

function getCurrentUserId() {
  return window._fumocaSession?.user?.id || null;
}

async function detectManagePermission() {
  const rec = window._fumocaCurrentRecord || {};
  const sb = window._fumocaSupabase;
  const user = window._fumocaSession?.user || null;
  let role = user?.user_metadata?.role || null;
  try {
    if (sb && user?.id) {
      const { data } = await sb.from('profiles').select('id').eq('id', user.id).maybeSingle();
      role = data ? role : role;
    }
  } catch (_) {}
  const isAdmin = ['admin', 'super_admin', 'owner'].includes(String(role || '').toLowerCase());
  const ownerId = rec.user_id || rec.owner_id || rec.created_by || rec.profile_id || rec.userId || null;
  state.canManage = !!(isAdmin || (user?.id && ownerId && user.id === ownerId));
  return state.canManage;
}

function getCssFocusPercent(name, fallback) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch (_) { return fallback; }
}

function getCurrentViewerAnchor() {
  const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
  const x = getCssFocusPercent('--focus-x', 50);
  const y = getCssFocusPercent('--focus-y', 42);
  const out = { x, y, wx: null, wy: null, wz: null };
  try {
    if (controls?.target) {
      out.wx = Number(controls.target.x);
      out.wy = Number(controls.target.y);
      out.wz = Number(controls.target.z);
      return out;
    }
    if (cam?.position && cam?.getWorldDirection) {
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const p = cam.position.clone().add(dir.multiplyScalar(1.5));
      out.wx = Number(p.x); out.wy = Number(p.y); out.wz = Number(p.z);
    }
  } catch (_) {}
  return out;
}

function getViewerRayFromEvent(event) {
  const stage = document.getElementById('stageHost') || document.getElementById('stage');
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
  const rect = stage?.getBoundingClientRect?.();
  if (!rect || !cam) return null;
  const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const probe = new THREE.Vector3(nx, ny, 0.5).unproject(cam);
  const direction = probe.sub(origin).normalize();
  return { origin, direction };
}

async function pickWorldAnchorFromEvent(event) {
  const ray = getViewerRayFromEvent(event);
  const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
  if (!ray || !cam) return null;
  const fallbackTarget = controls?.target?.clone?.() || new THREE.Vector3(0, 0, 0);
  try {
    await ensurePointCloudCache();
    const exact = pickPrecisePointOnSplat(ray, fallbackTarget);
    if (exact) return exact;
  } catch (_) {}
  const viewer = window._fumocaViewer || {};
  const meta = window._fumocaCurrentRecord?.metadata || {};
  const boundsRadius = Number(meta.radius || meta.bounding_radius || meta.bounds_radius || pointCloudCache.boundsRadius || viewer.boundsRadius || 0);
  const viewDist = Math.max(0.5, ray.origin.distanceTo(fallbackTarget));
  const radius = boundsRadius || Math.max(0.8, viewDist * 0.35);
  try {
    const hit = new THREE.Vector3();
    const sphere = new THREE.Sphere(fallbackTarget.clone(), radius);
    if (new THREE.Ray(ray.origin, ray.direction).intersectSphere(sphere, hit)) return hit.clone();
  } catch (_) {}
  try {
    const cameraDir = new THREE.Vector3();
    cam.getWorldDirection(cameraDir);
    const candidateDepths = [0, -radius * 0.2, radius * 0.12, -radius * 0.45, radius * 0.32, -radius * 0.72];
    const candidates = [];
    for (const offset of candidateDepths) {
      const planePoint = fallbackTarget.clone().add(cameraDir.clone().multiplyScalar(offset));
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(cameraDir, planePoint);
      const hit = new THREE.Vector3();
      if (new THREE.Ray(ray.origin, ray.direction).intersectPlane(plane, hit)) {
        const score = hit.distanceTo(fallbackTarget) + Math.abs(offset) * 0.18;
        candidates.push({ hit: hit.clone(), score });
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => a.score - b.score);
      return candidates[0].hit;
    }
  } catch (_) {}
  try {
    const depth = Math.max(0.4, ray.origin.distanceTo(fallbackTarget));
    return ray.origin.clone().add(ray.direction.clone().multiplyScalar(depth));
  } catch (_) {}
  return null;
}

function getStagePercentFromEvent(event) {
  const stage = document.getElementById('stageHost') || document.getElementById('stage');
  const rect = stage?.getBoundingClientRect?.();
  if (!rect) return { x: 50, y: 50 };
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  const y = ((event.clientY - rect.top) / rect.height) * 100;
  return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
}

function captureEventHotspotAnchor(event) {
  const screen = getStagePercentFromEvent(event);
  const live = getCurrentViewerAnchor();
  const picked = pickWorldAnchorFromEvent(event);
  return {
    ...live,
    x: screen.x,
    y: screen.y,
    wx: Number.isFinite(picked?.x) ? Number(picked.x) : live.wx,
    wy: Number.isFinite(picked?.y) ? Number(picked.y) : live.wy,
    wz: Number.isFinite(picked?.z) ? Number(picked.z) : live.wz,
  };
}

function normalizeHotspot(h, index = 0) {
  const action = h?.action || {};
  return {
    id: h?.id || uid(),
    title: h?.title || `Hotspot ${index + 1}`,
    type: h?.type || 'info',
    description: h?.description || '',
    zoom: Number.isFinite(+h?.zoom) ? +h.zoom : 1.12,
    x: Number.isFinite(+h?.x) ? +h.x : 50,
    y: Number.isFinite(+h?.y) ? +h.y : 50,
    wx: Number.isFinite(+h?.wx) ? +h.wx : null,
    wy: Number.isFinite(+h?.wy) ? +h.wy : null,
    wz: Number.isFinite(+h?.wz) ? +h.wz : null,
    link: h?.link || action.link || '',
    ctaLabel: h?.ctaLabel || action.ctaLabel || 'Open',
    ctaLink: h?.ctaLink || action.ctaLink || h?.link || '',
    sponsorLabel: h?.sponsorLabel || action.sponsorLabel || '',
    sponsorLogo: h?.sponsorLogo || action.sponsorLogo || '',
    mediaImage: h?.mediaImage || action.mediaImage || '',
    mediaVideo: h?.mediaVideo || action.mediaVideo || '',
    gallery: Array.isArray(h?.gallery) ? h.gallery : (Array.isArray(action.gallery) ? action.gallery : []),
    audioUrl: h?.audioUrl || action.audioUrl || '',
    audioAutoplay: !!(h?.audioAutoplay ?? action.audioAutoplay ?? false),
    overlayUrl: h?.overlayUrl || action.overlayUrl || '',
    overlaySplatId: h?.overlaySplatId || action.overlaySplatId || '',
    overlayMode: h?.overlayMode || action.overlayMode || 'overlay',
    overlayAutoplay: !!(h?.overlayAutoplay ?? action.overlayAutoplay ?? false),
    scenePreset: h?.scenePreset || action.scenePreset || '',
    revealTarget: h?.revealTarget || action.revealTarget || '',
    nextId: h?.nextId || action.nextId || '',
    productLabel: h?.productLabel || action.productLabel || '',
    productPrice: h?.productPrice || action.productPrice || '',
    action,
  };
}

async function loadHotspots() {
  const rec = window._fumocaCurrentRecord || {};
  const meta = rec.metadata || {};
  let list = Array.isArray(meta.hotspots) ? meta.hotspots : null;
  if (!list) {
    try {
      const raw = localStorage.getItem(localKey());
      if (raw) list = JSON.parse(raw);
    } catch (_) {}
  }
  state.hotspots = (Array.isArray(list) ? list : []).map(normalizeHotspot);
  state.loaded = true;
  renderPanel();
  renderHotspots();
  window.dispatchEvent(new CustomEvent('fumoca:hotspotsLoaded', { detail: { count: state.hotspots.length } }));
}

function persistLocal() {
  try { localStorage.setItem(localKey(), JSON.stringify(state.hotspots)); } catch (_) {}
}

async function saveRemote() {
  if (state.saving) return;
  const sb = window._fumocaSupabase;
  const rec = window._fumocaCurrentRecord || {};
  if (!sb || !rec?.id) {
    persistLocal();
    return false;
  }
  state.saving = true;
  try {
    const metadata = { ...(rec.metadata || {}), hotspots: state.hotspots };
    const { error } = await sb.from('splats').update({ metadata }).eq('id', rec.id);
    if (error) throw error;
    window._fumocaCurrentRecord = { ...rec, metadata };
    persistLocal();
    track('hotspot_save', { recordId: rec.id, count: state.hotspots.length });
    return true;
  } catch (err) {
    console.warn('[hotspot-pro] remote save failed, using local backup', err);
    persistLocal();
    return false;
  } finally {
    state.saving = false;
    renderPanel();
  }
}

function projectWorldToScreen(wx, wy, wz) {
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
  if (!cam || [wx, wy, wz].some(v => !Number.isFinite(v))) return null;
  try {
    const v = new THREE.Vector3(wx, wy, wz).project(cam);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.z > 1.2) return null;
    return {
      x: ((v.x + 1) / 2) * 100,
      y: ((1 - v.y) / 2) * 100,
      behind: v.z < -1 || v.z > 1,
    };
  } catch (_) { return null; }
}

function getRenderPosition(h) {
  const projected = projectWorldToScreen(h.wx, h.wy, h.wz);
  if (projected && !projected.behind) {
    state.worldProjectionEnabled = true;
    return projected;
  }
  return { x: h.x, y: h.y, behind: false };
}

function stopAudio() {
  try {
    state.activeAudio?.pause?.();
    if (state.activeAudio) state.activeAudio.currentTime = 0;
  } catch (_) {}
  state.activeAudio = null;
}

function playHotspotAudio(h) {
  if (!h.audioUrl) return;
  try {
    stopAudio();
    const audio = new Audio(h.audioUrl);
    audio.preload = 'auto';
    audio.play().catch(() => {});
    state.activeAudio = audio;
    track('hotspot_audio_play', { id: h.id, type: h.type });
  } catch (_) {}
}

function buildNestedSplatUrl(h) {
  if (h.overlayUrl) {
    if (/viewer\.html/i.test(h.overlayUrl)) return h.overlayUrl;
    return `embed/viewer.html?file=${encodeURIComponent(h.overlayUrl)}`;
  }
  if (h.overlaySplatId) return `embed/viewer.html?splatId=${encodeURIComponent(h.overlaySplatId)}`;
  if (h.link && /\.(splat|ply|ksplat)(\?|$)/i.test(h.link)) {
    return `embed/viewer.html?file=${encodeURIComponent(h.link)}`;
  }
  return '';
}

function closeNestedSplat() {
  if (!nestedOverlay) return;
  nestedOverlay.classList.remove('visible', 'ready');
  nestedOverlay.setAttribute('aria-hidden', 'true');
  if (nestedFrame) nestedFrame.src = 'about:blank';
  state.overlayUrl = '';
}

function openNestedSplat(h) {
  const url = buildNestedSplatUrl(h);
  if (!url || !nestedOverlay || !nestedFrame) return false;
  state.overlayUrl = url;
  nestedTitle.textContent = h.title || 'Nested experience';
  nestedSub.textContent = h.description || 'Interactive overlay splat';
  nestedMeta.textContent = h.productLabel
    ? `${h.productLabel}${h.productPrice ? ` · ${h.productPrice}` : ''}`
    : (h.sponsorLabel ? `Sponsored by ${h.sponsorLabel}` : 'Interactive overlay splat');
  nestedOverlay.classList.add('visible');
  nestedOverlay.setAttribute('aria-hidden', 'false');
  nestedOverlay.classList.remove('ready');
  nestedFrame.src = url;
  track('nested_splat_open', { id: h.id, type: h.type });
  return true;
}

function flyToHotspot(h) {
  const focusX = `${Math.max(4, Math.min(96, h.x))}%`;
  const focusY = `${Math.max(4, Math.min(96, h.y))}%`;
  document.documentElement.style.setProperty('--focus-x', focusX);
  document.documentElement.style.setProperty('--focus-y', focusY);
  document.documentElement.style.setProperty('--focus-size', h.type === 'tour' ? '28%' : '24%');
  document.documentElement.style.setProperty('--focus-opacity', '0.12');
  document.documentElement.style.setProperty('--outer-opacity', '0.32');
  document.documentElement.style.setProperty('--subject-scale', String(Math.max(1, Math.min(1.45, h.zoom || 1.12))));

  try {
    if (window._fumocaCameraEngine?.flyToHotspot) {
      const ok = window._fumocaCameraEngine.flyToHotspot(h);
      if (ok) return;
    }
  } catch (err) {
    console.warn('[hotspot-pro] camera-engine fallback', err);
  }

  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
  const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
  if (cam && controls && [h.wx, h.wy, h.wz].every(v => Number.isFinite(v))) {
    try {
      const target = new THREE.Vector3(h.wx, h.wy, h.wz);
      const startPos = cam.position.clone();
      const startTarget = controls.target?.clone ? controls.target.clone() : new THREE.Vector3();
      const dir = startPos.clone().sub(startTarget).normalize();
      const dist = Math.max(0.35, startPos.distanceTo(startTarget) / Math.max(1.02, h.zoom || 1.12));
      const endTarget = target.clone();
      const endPos = endTarget.clone().add(dir.multiplyScalar(dist));
      const t0 = performance.now();
      const duration = 950;
      const tick = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        const e = 1 - Math.pow(1 - p, 3);
        cam.position.lerpVectors(startPos, endPos, e);
        if (controls.target?.lerpVectors) controls.target.lerpVectors(startTarget, endTarget, e);
        controls.update?.();
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return;
    } catch (err) {
      console.warn('[hotspot-pro] flyTo fallback', err);
    }
  }

  const stageHost = document.getElementById('stageHost') || document.getElementById('stage');
  if (stageHost) {
    stageHost.animate(
      [
        { transform: 'scale(1) translate3d(0,0,0)' },
        { transform: `scale(${Math.max(1.02, Math.min(1.18, h.zoom || 1.1))}) translate3d(${(50 - h.x) * 0.18}px, ${(50 - h.y) * 0.18}px, 0)` },
      ],
      { duration: 800, easing: 'cubic-bezier(.2,.85,.2,1)', fill: 'forwards' }
    );
  }
}

function jumpToHotspotById(id) {
  const h = state.hotspots.find(x => x.id === id);
  if (!h) return;
  flyToHotspot(h);
  openInfo(h);
}

function activateHotspot(h) {
  flyToHotspot(h);
  if (h.audioAutoplay && h.audioUrl) playHotspotAudio(h);
  if (h.type === 'reveal' && h.revealTarget) {
    window.dispatchEvent(new CustomEvent('fumoca:reveal', { detail: { target: h.revealTarget, hotspot: h } }));
  }
  if (h.type === 'tour_jump' && h.nextId) jumpToHotspotById(h.nextId);
  if (h.type === 'splat_overlay' && h.overlayAutoplay) openNestedSplat(h);
  openInfo(h);
  track('hotspot_activate', { id: h.id, type: h.type });
}

function actionButtons(h) {
  const buttons = [];
  if (h.audioUrl) buttons.push(`<button class="e-btn e-btn-acid" data-hs-audio="${h.id}">${state.activeAudio ? 'Restart audio' : 'Play audio'}</button>`);
  if (buildNestedSplatUrl(h)) buttons.push(`<button class="e-btn e-btn-primary" data-hs-overlay="${h.id}">Open nested splat</button>`);
  if (h.ctaLink) buttons.push(`<a href="${escapeHtml(h.ctaLink)}" target="_blank" rel="noopener" class="e-btn e-btn-warn" style="text-decoration:none;display:inline-block;">${escapeHtml(h.ctaLabel || 'Open')}</a>`);
  else if (h.link) buttons.push(`<a href="${escapeHtml(h.link)}" target="_blank" rel="noopener" class="e-btn e-btn-warn" style="text-decoration:none;display:inline-block;">Open link</a>`);
  if (state.canManage) buttons.push(`<button class="e-btn e-btn-ghost" data-hs-edit="${h.id}">Edit hotspot</button><button class="e-btn e-btn-danger" data-hs-delete="${h.id}">Delete hotspot</button>`);
  buttons.push(`<button class="e-btn e-btn-acid" id="hsNextBtn">Next</button>`);
  return buttons.join('');
}

function renderGallery(h) {
  if (!Array.isArray(h.gallery) || !h.gallery.length) return '';
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:8px;">${h.gallery.slice(0,6).map(src => `<a href="${escapeHtml(src)}" target="_blank" rel="noopener" style="display:block;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.08);"><img src="${escapeHtml(src)}" alt="gallery item" style="width:100%;height:84px;object-fit:cover;display:block;background:#0b0e14;"></a>`).join('')}</div>`;
}

function renderMedia(h) {
  if (h.mediaVideo) return `<video src="${escapeHtml(h.mediaVideo)}" controls playsinline style="width:100%;border-radius:14px;background:#05070b;"></video>`;
  if (h.mediaImage) return `<img src="${escapeHtml(h.mediaImage)}" alt="${escapeHtml(h.title)}" style="width:100%;border-radius:14px;display:block;background:#05070b;max-height:220px;object-fit:cover;">`;
  return '';
}

function openInfo(h) {
  state.activeId = h.id;
  hotspotInfoCard.classList.add('visible');
  hotspotInfoCard.setAttribute('aria-hidden', 'false');
  const sponsor = h.sponsorLabel ? `<span class="lasso-badge">Sponsor · ${escapeHtml(h.sponsorLabel)}</span>` : '';
  const product = h.productLabel ? `<span class="lasso-badge">${escapeHtml(h.productLabel)}${h.productPrice ? ` · ${escapeHtml(h.productPrice)}` : ''}</span>` : '';
  const preset = h.scenePreset ? `<span class="lasso-badge">${escapeHtml(h.scenePreset)}</span>` : '';
  hotspotInfoCard.innerHTML = `
    <div style="padding:16px 16px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
      <div>
        <div style="font-family:var(--font-display);font-size:24px;line-height:1;color:var(--neon);letter-spacing:.05em;">${escapeHtml(h.title)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:4px;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(h.type)}</div>
      </div>
      <button class="ghostBtn" id="hsCloseInfo">✕</button>
    </div>
    <div style="padding:14px 16px 16px;display:grid;gap:10px;max-height:min(72vh,760px);overflow:auto;">
      ${renderMedia(h)}
      <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,.78);">${escapeHtml(h.description || 'Interactive focus point')}</div>
      <div class="lasso-chip-row">
        <span class="lasso-badge">Zoom ${(h.zoom || 1.12).toFixed(2)}×</span>
        ${Number.isFinite(h.wx) ? '<span class="lasso-badge">3D anchor</span>' : '<span class="lasso-badge">Screen anchor</span>'}
        ${sponsor}${product}${preset}
      </div>
      ${renderGallery(h)}
      <div class="panel-actions">${actionButtons(h)}</div>
    </div>`;

  document.getElementById('hsCloseInfo')?.addEventListener('click', closeInfo);
  document.getElementById('hsNextBtn')?.addEventListener('click', nextHotspot);
  hotspotInfoCard.querySelector('[data-hs-edit]')?.addEventListener('click', () => openPanel(true));
  hotspotInfoCard.querySelector('[data-hs-delete]')?.addEventListener('click', async () => {
    if (!state.canManage || !confirm('Delete this hotspot?')) return;
    state.hotspots = state.hotspots.filter(x => x.id !== h.id);
    closeInfo();
    renderHotspots();
    renderPanel();
    await saveRemote();
  });
  hotspotInfoCard.querySelector('[data-hs-audio]')?.addEventListener('click', () => playHotspotAudio(h));
  hotspotInfoCard.querySelector('[data-hs-overlay]')?.addEventListener('click', () => openNestedSplat(h));
  // v78 — multi-action hotspots: render action buttons if the hotspot has an actions array
  if (Array.isArray(h.actions) && h.actions.length) {
    const body = hotspotInfoCard.querySelector('.panel-actions')?.parentElement
              || hotspotInfoCard.querySelector('div[style*="padding:14px"]')
              || hotspotInfoCard;
    renderActionButtons(h, body, { hotspot: h });
  }
  renderHotspots();
  window.dispatchEvent(new CustomEvent('fumoca:hotspotOpened', { detail: { id: h.id, type: h.type } }));
}

function closeInfo() {
  hotspotInfoCard.classList.remove('visible');
  hotspotInfoCard.setAttribute('aria-hidden', 'true');
  state.activeId = null;
  renderHotspots();
}

function renderHotspots() {
  window._fumocaHotspots = state.hotspots.slice();
  if (!hotspotLayer) return;
  hotspotLayer.innerHTML = '';
  for (const h of state.hotspots) {
    const pos = getRenderPosition(h);
    const el = document.createElement('button');
    el.className = `hotspot-marker${state.activeId === h.id ? ' active pulse' : ''}`;
    el.dataset.id = h.id;
    el.dataset.type = h.type;
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    el.title = h.title;
    el.innerHTML = `<span class="hotspot-pill">${escapeHtml(h.title)}</span>`;
    el.addEventListener('click', () => activateHotspot(h));
    hotspotLayer.appendChild(el);
  }
}

function nextHotspot() {
  if (!state.hotspots.length) return;
  const idx = state.hotspots.findIndex(h => h.id === state.activeId);
  const next = state.hotspots[(idx + 1 + state.hotspots.length) % state.hotspots.length];
  if (next) activateHotspot(next);
}

function stopTour() {
  state.tourActive = false;
  if (state.tourTimer) clearTimeout(state.tourTimer);
  state.tourTimer = null;
  window.dispatchEvent(new CustomEvent('fumoca:tourStopped'));
  renderPanel();
}

function startTour() {
  if (!state.hotspots.length) return;
  state.tourActive = true;
  const ordered = state.hotspots.slice();
  const run = () => {
    if (!state.tourActive || !ordered.length) return;
    state.tourIndex = (state.tourIndex + 1) % ordered.length;
    const h = ordered[state.tourIndex];
    activateHotspot(h);
    state.tourTimer = setTimeout(run, state.tourDelay);
  };
  run();
  window.dispatchEvent(new CustomEvent('fumoca:tourStarted', { detail: { count: ordered.length } }));
  renderPanel();
}

function advancedPrompt(defaults = {}) {
  const template = {
    type: defaults.type || 'info',
    description: defaults.description || '',
    zoom: defaults.zoom || 1.12,
    ctaLabel: defaults.ctaLabel || 'Open',
    ctaLink: defaults.ctaLink || defaults.link || '',
    sponsorLabel: defaults.sponsorLabel || '',
    mediaImage: defaults.mediaImage || '',
    mediaVideo: defaults.mediaVideo || '',
    gallery: defaults.gallery || [],
    audioUrl: defaults.audioUrl || '',
    audioAutoplay: defaults.audioAutoplay || false,
    overlayUrl: defaults.overlayUrl || '',
    overlaySplatId: defaults.overlaySplatId || '',
    overlayAutoplay: defaults.overlayAutoplay || false,
    overlayMode: defaults.overlayMode || 'overlay',
    scenePreset: defaults.scenePreset || '',
    revealTarget: defaults.revealTarget || '',
    nextId: defaults.nextId || '',
    productLabel: defaults.productLabel || '',
    productPrice: defaults.productPrice || ''
  };
  const raw = prompt('Optional advanced hotspot JSON. Leave as-is or edit fields like overlayUrl, audioUrl, ctaLink, sponsorLabel, mediaImage, gallery.', JSON.stringify(template, null, 2));
  if (raw == null) return defaults;
  try {
    return { ...defaults, ...JSON.parse(raw) };
  } catch (err) {
    alert('Advanced JSON was invalid. Keeping the basic fields.');
    return defaults;
  }
}

function promptHotspot(seed = null) {
  const anchor = getCurrentViewerAnchor();
  const h = seed ? { ...seed } : normalizeHotspot({ ...anchor }, state.hotspots.length);
  const title = prompt('Hotspot title', h.title);
  if (title == null) return null;
  h.title = title.trim() || h.title;
  const type = prompt('Hotspot type: info, audio, link, tour, reveal, tour_jump, splat_overlay, product, sponsor', h.type);
  if (type == null) return null;
  h.type = (type.trim() || h.type).toLowerCase();
  const description = prompt('Description', h.description || '');
  if (description == null) return null;
  h.description = description;
  const zoom = prompt('Zoom amount (example 1.12)', String(h.zoom ?? 1.12));
  if (zoom == null) return null;
  h.zoom = Math.max(1, Math.min(2.5, Number(zoom) || 1.12));
  const link = prompt('Optional fallback link / CTA link', h.link || h.ctaLink || '');
  if (link == null) return null;
  h.link = link.trim();
  const capture = prompt('Capture current camera target as this hotspot anchor? Type yes to use current view.', 'yes');
  if (capture && capture.trim().toLowerCase() === 'yes') {
    const live = getCurrentViewerAnchor();
    h.x = live.x; h.y = live.y; h.wx = live.wx; h.wy = live.wy; h.wz = live.wz;
  }
  return advancedPrompt(h);
}

function renderPanel() {
  if (!hotspotPanel) return;
  const rows = state.hotspots.map((h) => `
    <div class="e-control" data-row="${h.id}">
      <div class="e-label"><span>${escapeHtml(h.title)}</span><span class="e-val">${escapeHtml(h.type)}</span></div>
      <div class="e-note">${escapeHtml(h.description || 'No description')} · zoom ${(h.zoom || 1.12).toFixed(2)}×${buildNestedSplatUrl(h) ? ' · nested splat' : ''}${h.audioUrl ? ' · audio' : ''}${h.ctaLink ? ' · cta' : ''}</div>
      <div class="panel-actions" style="margin-top:10px;">
        <button class="e-btn e-btn-acid" data-action="fly" data-id="${h.id}">Go</button>
        ${buildNestedSplatUrl(h) ? `<button class="e-btn e-btn-primary" data-action="overlay" data-id="${h.id}">Overlay</button>` : ''}
        ${state.canManage ? `<button class="e-btn e-btn-ghost" data-action="edit" data-id="${h.id}">Edit</button><button class="e-btn e-btn-danger" data-action="delete" data-id="${h.id}">Delete</button>` : ''}
      </div>
    </div>`).join('');

  hotspotPanel.innerHTML = `
    <div class="edit-header">
      <div>
        <div class="edit-title">HOTSPOTS PRO</div>
        <div class="edit-sub">Universal scene actions · overlays · audio · CTAs · owner-only management</div>
      </div>
      <button class="ghostBtn" id="hsPanelClose">✕</button>
    </div>
    <div class="edit-pane active" style="display:block;">
      <div class="e-stats">
        <div class="e-stat"><div class="e-stat-val">${state.hotspots.length}</div><div class="e-stat-lbl">Hotspots</div></div>
        <div class="e-stat sel"><div class="e-stat-val">${state.canManage ? 'OWNER' : 'VIEW'}</div><div class="e-stat-lbl">Access</div></div>
        <div class="e-stat warn"><div class="e-stat-val">${state.worldProjectionEnabled ? '3D' : '2D'}</div><div class="e-stat-lbl">Anchor mode</div></div>
      </div>
      <div class="e-control">
        <div class="e-label"><span>Experience actions</span><span class="e-val">${state.saving ? 'Saving…' : 'Ready'}</span></div>
        <button class="e-btn e-btn-primary" id="hsNextTour">Next hotspot</button>
        <button class="e-btn e-btn-warn" id="hsToggleTour">${state.tourActive ? 'Stop tour' : 'Start tour'}</button>
        ${state.canManage ? '<button class="e-btn e-btn-acid" id="hsAdd">Add hotspot</button><button class="e-btn e-btn-ghost" id="hsCaptureCurrent">Capture current view</button><button class="e-btn e-btn-ghost" id="hsSave">Save hotspots</button>' : ''}
        <div class="e-note">Every hotspot can become a universal scene action. Use type splat_overlay for nested interactive splats, audio for sound triggers, product/sponsor for commerce-ready moments, and reveal or tour_jump for guided journeys. Shift + double-click the stage to capture a hotspot from the real viewer focus.</div>
      </div>
      ${rows || '<div class="e-control"><div class="e-note">No hotspots yet.</div></div>'}
    </div>`;

  hotspotPanel.querySelector('#hsPanelClose')?.addEventListener('click', () => openPanel(false));
  hotspotPanel.querySelector('#hsNextTour')?.addEventListener('click', nextHotspot);
  hotspotPanel.querySelector('#hsToggleTour')?.addEventListener('click', () => { if (state.tourActive) stopTour(); else startTour(); });
  hotspotPanel.querySelector('#hsAdd')?.addEventListener('click', async () => {
    const created = promptHotspot({ x: 50, y: 50 });
    if (!created) return;
    state.hotspots.push(normalizeHotspot(created, state.hotspots.length));
    renderHotspots(); renderPanel();
    saveRemote();
  });
  hotspotPanel.querySelector('#hsCaptureCurrent')?.addEventListener('click', () => {
    const created = promptHotspot(getCurrentViewerAnchor());
    if (!created) return;
    state.hotspots.push(normalizeHotspot(created, state.hotspots.length));
    renderHotspots(); renderPanel();
    saveRemote();
  });
  hotspotPanel.querySelector('#hsSave')?.addEventListener('click', async () => { await saveRemote(); renderPanel(); });
  hotspotPanel.querySelectorAll('[data-action="fly"]').forEach(btn => btn.addEventListener('click', () => {
    const h = state.hotspots.find(x => x.id === btn.dataset.id); if (h) activateHotspot(h);
  }));
  hotspotPanel.querySelectorAll('[data-action="overlay"]').forEach(btn => btn.addEventListener('click', () => {
    const h = state.hotspots.find(x => x.id === btn.dataset.id); if (h) openNestedSplat(h);
  }));
  hotspotPanel.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => {
    const idx = state.hotspots.findIndex(x => x.id === btn.dataset.id);
    if (idx < 0) return;
    const updated = promptHotspot(state.hotspots[idx]);
    if (!updated) return;
    state.hotspots[idx] = normalizeHotspot({ ...state.hotspots[idx], ...updated }, idx);
    renderHotspots(); renderPanel();
    saveRemote();
  }));
  hotspotPanel.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => {
    const idx = state.hotspots.findIndex(x => x.id === btn.dataset.id);
    if (idx < 0 || !confirm('Delete this hotspot?')) return;
    state.hotspots.splice(idx, 1);
    if (state.activeId === btn.dataset.id) closeInfo();
    renderHotspots(); renderPanel();
    saveRemote();
  }));
}

function openPanel(open = true) {
  hotspotPanel.classList.toggle('open', open);
  hotspotPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function attachUi() {
  hotspotBtn?.addEventListener('click', () => openPanel(!hotspotPanel.classList.contains('open')));
  nestedClose?.addEventListener('click', closeNestedSplat);
  nestedOverlay?.addEventListener('click', (e) => { if (e.target === nestedOverlay) closeNestedSplat(); });
  nestedOpenNew?.addEventListener('click', () => { if (state.overlayUrl) window.open(state.overlayUrl, '_blank', 'noopener'); });
  nestedFrame?.addEventListener('load', () => nestedOverlay?.classList.add('ready'));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNestedSplat(); });
  window.addEventListener('resize', renderHotspots);
  window.addEventListener('fumoca:viewerReady', renderHotspots);
  window.addEventListener('fumoca:recordLoaded', async () => { await detectManagePermission(); await loadHotspots(); renderPanel(); });
  // Editor: reload hotspots when a new file loads and reset point cloud cache
  window.addEventListener('fumoca:fileLoaded', async () => {
    pointCloudCache.loaded = false; pointCloudCache.url = '';
    await loadHotspots(); renderHotspots();
  });
  window.addEventListener('fumoca:permissionsReady', (e) => { state.canManage = !!e.detail?.canManage; renderPanel(); });
  window.addEventListener('fumoca:permissionsUpdated', (e) => { state.canManage = !!e.detail?.canManage; renderPanel(); });
  const stage = document.getElementById('stageHost') || document.getElementById('stage');
  stage?.addEventListener('dblclick', async (event) => {
    if (!state.canManage || !event.shiftKey) return;
    event.preventDefault();
    const created = promptHotspot(await captureEventHotspotAnchor(event));
    if (!created) return;
    state.hotspots.push(normalizeHotspot(created, state.hotspots.length));
    renderHotspots(); renderPanel();
    saveRemote();
  });
  const loop = () => { renderHotspots(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}

async function init() {
  // In editor context, always allow management (user is editing their own splat)
  const isEditor = !!document.getElementById('brushRing');
  if (isEditor) state.canManage = true;
  else await detectManagePermission();
  await loadHotspots();
  attachUi();
}

init();

window._fumocaTour = { start: startTour, stop: stopTour, next: nextHotspot };
window._fumocaHotspots = state.hotspots.slice();
window._fumocaOpenNestedSplat = openNestedSplat;
// Expose cache so editor can invalidate it after edits
window._fumocaHotspotPointCloudCache = pointCloudCache;
