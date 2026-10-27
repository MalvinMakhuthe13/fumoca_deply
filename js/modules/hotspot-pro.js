window._fumocaUseHotspotPro = true;

import * as THREE from 'three';
import { renderActionButtons } from './hotspot-actions.js';
import { authorPartToggle } from './nif-part-toggle.js';

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

async function ensurePointCloudCache({ force = false } = {}) {
  // In edit.html, read positions directly from window.S (already loaded, no fetch needed)
  if (window.S?.positions?.length && (force || !pointCloudCache.loaded || pointCloudCache.url === 'editor_live')) {
    const pos = window.S.positions;
    const alive = window.S.alive;
    const out = [];
    let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity;
    // Stride sample for speed on large clouds; keep denser near surface picks
    const n = alive?.length || (pos.length / 3);
    const stride = n > 120000 ? 4 : n > 60000 ? 2 : 1;
    for (let i = 0; i < n; i += stride) {
      if (alive && !alive[i]) continue;
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      out.push(x, y, z);
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (out.length >= 9) {
      pointCloudCache.positions = new Float32Array(out);
      pointCloudCache.count = out.length / 3;
      pointCloudCache.boundsCenter = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      pointCloudCache.boundsRadius = Math.max(0.5, Math.sqrt(((x1 - x0) ** 2 + (y1 - y0) ** 2 + (z1 - z0) ** 2) / 4));
      pointCloudCache.loaded = true;
      pointCloudCache.url = 'editor_live';
      return pointCloudCache;
    }
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
  // Wider search so door/boot clicks still latch onto the body surface
  const maxRadius = Math.max(0.25, (cache.boundsRadius || 1) * 0.12);
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
  tourLoop: true,
  activeAudio: null,
  overlayUrl: '',
  // Guided placement / editor
  placeMode: false,
  editingId: null,   // id of hotspot being edited, or null when creating
  draft: null,       // in-progress hotspot object while placing/editing
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

function _getViewRect() {
  // Studio renders into #viewport; viewer uses #stage / #stageHost.
  // Always prefer the live WebGL canvas when present.
  const canvas =
    document.querySelector('#viewport canvas') ||
    document.querySelector('#stageHost canvas') ||
    document.querySelector('#stage canvas') ||
    document.querySelector('canvas');
  if (canvas) return canvas.getBoundingClientRect();
  const host =
    document.getElementById('viewport') ||
    document.getElementById('stageHost') ||
    document.getElementById('stage');
  return host?.getBoundingClientRect?.() || null;
}

function getViewerRayFromEvent(event) {
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera;
  const rect = _getViewRect();
  if (!rect || !cam || rect.width < 2 || rect.height < 2) return null;
  cam.updateMatrixWorld?.(true);
  const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const probe = new THREE.Vector3(nx, ny, 0.5).unproject(cam);
  const direction = probe.sub(origin).normalize();
  return { origin, direction, rect };
}

async function pickWorldAnchorFromEvent(event) {
  const ray = getViewerRayFromEvent(event);
  const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera;
  if (!ray || !cam) return null;
  const fallbackTarget = controls?.target?.clone?.() || new THREE.Vector3(0, 0, 0);
  try {
    await ensurePointCloudCache({ force: true });
    const exact = pickPrecisePointOnSplat(ray, fallbackTarget);
    if (exact) return exact;
  } catch (_) {}
  const viewer = window._fumocaViewer || {};
  const meta = window._fumocaCurrentRecord?.meta || {};
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
  const rect = _getViewRect();
  if (!rect || rect.width < 2) return { x: 50, y: 50 };
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
    // Preserve multi-action arrays used by vehicle demos & hotspot-actions
    actions: Array.isArray(h?.actions) ? h.actions : [],
    label: h?.label || h?.title || '',
    // Reaction controls what happens on click
    // Presets: fly | detail | image_detail | audio | link | overlay | custom
    reaction: h?.reaction || action.reaction || 'detail',
    flyOnActivate: h?.flyOnActivate !== false && action.flyOnActivate !== false,
    showCard: h?.showCard !== false && action.showCard !== false,
    cardLayout: h?.cardLayout || action.cardLayout || 'standard', // standard | side | wide
    keepInteractive: !!(h?.keepInteractive ?? action.keepInteractive ?? true),
    autoplayAudio: !!(h?.audioAutoplay ?? h?.autoplayAudio ?? action.audioAutoplay ?? false),
    openLinkOnActivate: !!(h?.openLinkOnActivate ?? action.openLinkOnActivate ?? false),
    presenterNotes: h?.presenterNotes || action.presenterNotes || '',
    action,
  };
}

async function loadHotspots(externalList = null) {
  // Prefer an explicit list (e.g. from hotspot-persist), then canonical meta,
  // then legacy metadata, then localStorage, then the shared window cache.
  let list = Array.isArray(externalList) ? externalList : null;
  if (!list) {
    const rec = window._fumocaCurrentRecord || {};
    const meta = (rec.meta && typeof rec.meta === 'object' ? rec.meta : null)
              || (rec.metadata && typeof rec.metadata === 'object' ? rec.metadata : null)
              || {};
    list = Array.isArray(meta.hotspots) ? meta.hotspots
         : (Array.isArray(meta.interactions?.hotspots) ? meta.interactions.hotspots : null);
  }
  if (!list && Array.isArray(window._fumocaHotspots) && window._fumocaHotspots.length) {
    list = window._fumocaHotspots;
  }
  if (!list) {
    try {
      const raw = localStorage.getItem(localKey());
      if (raw) list = JSON.parse(raw);
    } catch (_) {}
  }
  state.hotspots = (Array.isArray(list) ? list : []).map(normalizeHotspot);
  state.loaded = true;
  window._fumocaHotspots = state.hotspots.slice();
  renderPanel();
  renderHotspots();
  // Upgrade screen-only anchors to 3D when the live point cloud is available
  _upgradeScreenAnchorsToWorld().catch(() => {});
  window.dispatchEvent(new CustomEvent('fumoca:hotspotsLoaded', { detail: { count: state.hotspots.length } }));
}

async function _upgradeScreenAnchorsToWorld() {
  const need = state.hotspots.filter((h) => !Number.isFinite(h.wx) || !Number.isFinite(h.wy) || !Number.isFinite(h.wz));
  if (!need.length) return;
  await ensurePointCloudCache({ force: true });
  if (!pointCloudCache.positions?.length) return;
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera;
  const view = _getViewRect();
  if (!cam || !view) return;
  cam.updateMatrixWorld?.(true);
  let upgraded = 0;
  for (const h of need) {
    const nx = ((h.x / 100) * 2) - 1;
    const ny = -(((h.y / 100) * 2) - 1);
    const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const probe = new THREE.Vector3(nx, ny, 0.5).unproject(cam);
    const direction = probe.sub(origin).normalize();
    const hit = pickPrecisePointOnSplat({ origin, direction }, window._fumocaViewerControls?.target);
    if (hit && Number.isFinite(hit.x)) {
      h.wx = hit.x; h.wy = hit.y; h.wz = hit.z;
      upgraded++;
    }
  }
  if (upgraded) {
    window._fumocaHotspots = state.hotspots.slice();
    renderHotspots();
    console.info('[hotspot-pro] upgraded', upgraded, 'screen anchors to 3D');
    // Notify navigation controls after asynchronous world-anchor recovery finishes.
    window.dispatchEvent(new CustomEvent('fumoca:hotspotsLoaded', {
      detail: { count: state.hotspots.length, spatialCount: state.hotspots.filter(h =>
        Number.isFinite(h.wx) && Number.isFinite(h.wy) && Number.isFinite(h.wz)
      ).length, upgraded }
    }));
  } else {
    console.info('[hotspot-pro] no screen anchors upgraded; navigation needs authored 3D hotspot coordinates');
  }
}

function persistLocal() {
  try { localStorage.setItem(localKey(), JSON.stringify(state.hotspots)); } catch (_) {}
}

/**
 * Keep a real nif_products row in sync with any product-type hotspot.
 *
 * WHY THIS EXISTS: the existing product-authoring flow (advancedPrompt())
 * stores productLabel/productPrice directly on the hotspot as plain text —
 * there was never a real backing product record. That's fine for display,
 * but js/modules/commerce.js's checkout now calls a server-side RPC
 * (create_order_from_cart, see supabase_migration_commerce.sql) that
 * re-prices from the real nif_products table and ignores anything it
 * doesn't recognize — a security requirement, not a choice, since the
 * whole point is never trusting a price the browser sends. Without this
 * sync, cart.js's `productId: hotspot.productId || hotspot.id` would
 * resolve to a hotspot ID that matches no real product row, and the RPC
 * would silently skip every single item — an empty order on every checkout
 * for every hotspot authored the old way. This keeps a real row present so
 * that path actually works, and writes the resulting id back onto the
 * hotspot so both systems agree on which product it is.
 */
async function _syncProductHotspots(sb, nifId, userId) {
  for (const h of state.hotspots) {
    if (h.type !== 'product' || !h.productLabel) continue;
    const payload = {
      nif_id: nifId, user_id: userId, hotspot_id: h.id,
      title: h.productLabel,
      price_cents: _parsePriceToCents(h.productPrice),
      currency: 'ZAR', active: true,
    };
    try {
      if (h.productId) {
        const { error } = await sb.from('nif_products').update(payload).eq('id', h.productId);
        if (error) console.warn('[hotspot-pro] product record update failed:', error.message);
      } else {
        const { data, error } = await sb.from('nif_products').insert(payload).select('id').single();
        if (error) { console.warn('[hotspot-pro] product record create failed:', error.message); continue; }
        h.productId = data.id;
      }
    } catch (err) {
      // Table may not exist yet if supabase_migration_commerce.sql hasn't
      // been run — don't let that break hotspot saving entirely.
      console.warn('[hotspot-pro] product sync skipped (has the commerce migration been run?):', err.message);
    }
  }
}

// Extracts the first number from a price string like "R199.99", "$49", "199"
// and converts to integer cents. Defensive since this field has always been
// free-text — there's no guarantee of a consistent currency symbol/format.
function _parsePriceToCents(priceStr) {
  const match = String(priceStr || '').match(/\d+(?:[.,]\d{1,2})?/);
  if (!match) return 0;
  return Math.round(parseFloat(match[0].replace(',', '.')) * 100);
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
    await _syncProductHotspots(sb, rec.id, rec.user_id);
    const metadata = { ...(rec.meta || {}), hotspots: state.hotspots };
    const { error } = await sb.from('nif_files').update({ meta: metadata }).eq('id', rec.id);
    if (error) throw error;
    window._fumocaCurrentRecord = { ...rec, meta: metadata };
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
  const cam = window._fumocaViewerCamera || window._fumocaViewer?.camera || window._fumocaCamera;
  if (!cam || [wx, wy, wz].some(v => !Number.isFinite(+v))) return null;
  try {
    cam.updateMatrixWorld?.(true);
    const v = new THREE.Vector3(+wx, +wy, +wz).project(cam);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    // Map NDC → pixels on the actual WebGL canvas, then → % of hotspotLayer
    // (critical in Studio where the canvas is only the center panel).
    const view = _getViewRect();
    const layer = hotspotLayer?.getBoundingClientRect?.();
    if (!view || !layer || layer.width < 2 || layer.height < 2) {
      return {
        x: ((v.x + 1) / 2) * 100,
        y: ((1 - v.y) / 2) * 100,
        behind: v.z < -1 || v.z > 1,
      };
    }
    const px = view.left + ((v.x + 1) / 2) * view.width;
    const py = view.top + ((1 - v.y) / 2) * view.height;
    return {
      x: ((px - layer.left) / layer.width) * 100,
      y: ((py - layer.top) / layer.height) * 100,
      behind: v.z < -1 || v.z > 1,
      px, py,
    };
  } catch (_) { return null; }
}

function getRenderPosition(h) {
  const projected = projectWorldToScreen(h.wx, h.wy, h.wz);
  if (projected && !projected.behind) {
    state.worldProjectionEnabled = true;
    return projected;
  }
  // Screen-space fallback: interpret x/y as % of the VIEW canvas, not the whole window
  const view = _getViewRect();
  const layer = hotspotLayer?.getBoundingClientRect?.();
  if (view && layer && layer.width > 2 && Number.isFinite(+h.x) && Number.isFinite(+h.y)) {
    const px = view.left + (+h.x / 100) * view.width;
    const py = view.top + (+h.y / 100) * view.height;
    return {
      x: ((px - layer.left) / layer.width) * 100,
      y: ((py - layer.top) / layer.height) * 100,
      behind: false,
    };
  }
  return { x: h.x || 50, y: h.y || 50, behind: false };
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


/* ═══════════════════════════════════════════════════════════════════════════
 * LIVING HOTSPOTS — scene-reactive differentiators
 * The 3D scene itself responds: isolate, evidence, story beats.
 * This is the product edge vs "popup on a 3D viewer" competitors.
 * ═══════════════════════════════════════════════════════════════════════════ */

const _scenePulse = {
  active: false,
  prevFocus: null,
  restoreTimer: null,
  storyTimer: null,
};

function _ensurePulseOverlay() {
  let el = document.getElementById('hsScenePulse');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hsScenePulse';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:4', 'pointer-events:none',
      'opacity:0', 'transition:opacity .45s ease',
      'background:radial-gradient(circle at 50% 50%, transparent 0%, transparent 12%, rgba(3,5,8,.55) 42%, rgba(3,5,8,.82) 100%)',
    ].join(';');
    // Breathing ring
    const ring = document.createElement('div');
    ring.id = 'hsScenePulseRing';
    ring.style.cssText = [
      'position:absolute', 'width:48px', 'height:48px', 'border-radius:999px',
      'border:2px solid rgba(200,255,0,.7)',
      'box-shadow:0 0 0 0 rgba(200,255,0,.35), 0 0 40px rgba(200,255,0,.25)',
      'transform:translate(-50%,-50%)', 'left:50%', 'top:50%',
      'animation:hsPulseBreath 2.2s ease-out infinite',
    ].join(';');
    el.appendChild(ring);
    if (!document.getElementById('hsPulseKeyframes')) {
      const style = document.createElement('style');
      style.id = 'hsPulseKeyframes';
      style.textContent = `
        @keyframes hsPulseBreath {
          0%   { transform:translate(-50%,-50%) scale(.85); opacity:1; box-shadow:0 0 0 0 rgba(200,255,0,.4); }
          70%  { transform:translate(-50%,-50%) scale(1.6); opacity:.35; box-shadow:0 0 0 28px rgba(200,255,0,0); }
          100% { transform:translate(-50%,-50%) scale(1.85); opacity:0; box-shadow:0 0 0 40px rgba(200,255,0,0); }
        }
      `;
      document.head.appendChild(style);
    }
    document.body.appendChild(el);
  }
  return el;
}

function startScenePulse(h) {
  const overlay = _ensurePulseOverlay();
  const ring = document.getElementById('hsScenePulseRing');
  const x = Number.isFinite(+h.x) ? +h.x : 50;
  const y = Number.isFinite(+h.y) ? +h.y : 50;

  // Remember prior focus CSS so we can restore
  const root = document.documentElement;
  if (!_scenePulse.prevFocus) {
    _scenePulse.prevFocus = {
      focusX: root.style.getPropertyValue('--focus-x'),
      focusY: root.style.getPropertyValue('--focus-y'),
      focusSize: root.style.getPropertyValue('--focus-size'),
      focusOpacity: root.style.getPropertyValue('--focus-opacity'),
      outerOpacity: root.style.getPropertyValue('--outer-opacity'),
      focusFeather: root.style.getPropertyValue('--focus-feather'),
    };
  }

  // Drive the existing focusOverlay vignette toward the hotspot
  root.style.setProperty('--focus-x', `${x}%`);
  root.style.setProperty('--focus-y', `${y}%`);
  root.style.setProperty('--focus-size', '28%');
  root.style.setProperty('--focus-feather', '14%');
  root.style.setProperty('--focus-opacity', '0.55');
  root.style.setProperty('--outer-opacity', '0.28');

  const focusOverlay = document.getElementById('focusOverlay');
  if (focusOverlay) focusOverlay.style.opacity = '1';

  // Soft stage treatment
  const stage = document.getElementById('stage');
  if (stage) {
    stage.style.filter = 'saturate(1.08) contrast(1.04)';
    stage.style.transition = 'filter .5s ease';
  }

  if (ring) {
    ring.style.left = `${x}%`;
    ring.style.top = `${y}%`;
  }
  overlay.style.background = `radial-gradient(circle at ${x}% ${y}%, transparent 0%, transparent 10%, rgba(3,5,8,.5) 38%, rgba(3,5,8,.84) 100%)`;
  overlay.style.opacity = '1';
  _scenePulse.active = true;

  // Auto-release after a beat unless locked by card
  if (_scenePulse.restoreTimer) clearTimeout(_scenePulse.restoreTimer);
  _scenePulse.restoreTimer = setTimeout(() => {
    // Keep pulse while info card is open for this hotspot
    if (state.activeId === h.id) return;
    stopScenePulse();
  }, 5200);

  window.dispatchEvent(new CustomEvent('fumoca:scenePulse', { detail: { id: h.id, x, y } }));
}

function stopScenePulse() {
  const overlay = document.getElementById('hsScenePulse');
  if (overlay) overlay.style.opacity = '0';
  const stage = document.getElementById('stage');
  if (stage) stage.style.filter = '';
  const root = document.documentElement;
  const prev = _scenePulse.prevFocus;
  if (prev) {
    for (const [k, v] of Object.entries(prev)) {
      const cssKey = '--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
      // map focusX → --focus-x etc.
    }
    // Explicit restore
    if (prev.focusX) root.style.setProperty('--focus-x', prev.focusX); else root.style.removeProperty('--focus-x');
    if (prev.focusY) root.style.setProperty('--focus-y', prev.focusY); else root.style.removeProperty('--focus-y');
    if (prev.focusSize) root.style.setProperty('--focus-size', prev.focusSize); else root.style.removeProperty('--focus-size');
    if (prev.focusOpacity) root.style.setProperty('--focus-opacity', prev.focusOpacity); else root.style.removeProperty('--focus-opacity');
    if (prev.outerOpacity) root.style.setProperty('--outer-opacity', prev.outerOpacity); else root.style.removeProperty('--outer-opacity');
    if (prev.focusFeather) root.style.setProperty('--focus-feather', prev.focusFeather); else root.style.removeProperty('--focus-feather');
  }
  _scenePulse.active = false;
  _scenePulse.prevFocus = null;
  if (_scenePulse.restoreTimer) { clearTimeout(_scenePulse.restoreTimer); _scenePulse.restoreTimer = null; }
}

function _evidenceFromRecord(h) {
  const rec = window._fumocaCurrentRecord || {};
  const meta = rec.meta || rec.metadata || {};
  const quality = meta.quality || meta.splat_quality || {};
  const capture = meta.capture || meta.capture_info || {};
  const dims = meta.dimensions || meta.measurements || h.measurements || {};

  const rows = [];
  rows.push({ label: 'Subject', value: h.title || rec.title || '—' });
  if (h.description) rows.push({ label: 'Detail', value: h.description });
  if (dims.length || dims.width || dims.height) {
    const parts = [dims.length, dims.width, dims.height].filter(Boolean).map(String);
    rows.push({ label: 'Dimensions', value: parts.join(' × ') + (dims.unit ? ` ${dims.unit}` : '') });
  }
  if (quality.score != null || quality.confidence != null) {
    rows.push({ label: 'Capture confidence', value: `${Math.round(Number(quality.score ?? quality.confidence))}%` });
  }
  if (capture.device || meta.device) rows.push({ label: 'Captured with', value: capture.device || meta.device });
  if (capture.date || rec.created_at) {
    const d = capture.date || rec.created_at;
    try { rows.push({ label: 'Captured', value: new Date(d).toLocaleString() }); }
    catch (_) { rows.push({ label: 'Captured', value: String(d) }); }
  }
  if (capture.location || meta.location || rec.location) {
    rows.push({ label: 'Location', value: capture.location || meta.location || rec.location });
  }
  if (meta.verified || rec.verified) rows.push({ label: 'Status', value: '✓ Verified spatial capture' });
  if (h.productLabel) rows.push({ label: 'Product', value: h.productLabel + (h.productPrice ? ` · ${h.productPrice}` : '') });

  // Always show a FUMOCA differentiator line
  rows.push({ label: 'Spatial ID', value: (h.id || 'hs').slice(0, 12) + (Number.isFinite(h.wx) ? ' · 3D-anchored' : ' · view-anchored') });

  return rows;
}

function openEvidenceCard(h) {
  const rows = _evidenceFromRecord(h);
  // Reuse info card with evidence styling
  state.activeId = h.id;
  hotspotInfoCard.classList.add('visible');
  hotspotInfoCard.setAttribute('aria-hidden', 'false');
  hotspotInfoCard.dataset.layout = 'side';
  hotspotInfoCard.style.cssText = [
    'position:fixed', 'right:16px', 'top:72px', 'bottom:auto',
    'width:min(360px,calc(100vw - 32px))', 'max-height:calc(100vh - 100px)',
    'z-index:12', 'display:block', 'background:rgba(7,10,16,.96)',
    'border:1px solid rgba(200,255,0,.22)', 'border-radius:22px',
    'backdrop-filter:blur(18px)', 'box-shadow:0 18px 70px rgba(0,0,0,.5)',
    'overflow:hidden', 'pointer-events:auto',
  ].join(';');

  const media = renderMedia(h);
  hotspotInfoCard.innerHTML = `
    <div style="padding:14px 16px;border-bottom:1px solid rgba(200,255,0,.15);display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
      <div>
        <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:rgba(200,255,0,.75);margin-bottom:4px;">Spatial evidence</div>
        <div style="font-family:var(--font-display);font-size:20px;line-height:1.05;color:var(--neon);">${escapeHtml(h.title)}</div>
      </div>
      <button class="ghostBtn" id="hsCloseInfo" type="button">✕</button>
    </div>
    <div style="padding:14px 16px 16px;display:grid;gap:12px;max-height:min(70vh,720px);overflow:auto;">
      ${media || ''}
      <div style="display:grid;gap:0;border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow:hidden;">
        ${rows.map((r, i) => `
          <div style="display:grid;grid-template-columns:110px 1fr;gap:8px;padding:10px 12px;background:${i % 2 ? 'rgba(255,255,255,.02)' : 'transparent'};border-top:${i ? '1px solid rgba(255,255,255,.05)' : 'none'};">
            <div style="font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.4);padding-top:2px;">${escapeHtml(r.label)}</div>
            <div style="font-size:13px;color:rgba(255,255,255,.88);line-height:1.4;">${escapeHtml(String(r.value))}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,.4);line-height:1.5;">Evidence is derived from the spatial capture and hotspot anchor — not a flat photo annotation.</div>
      <div class="panel-actions">${actionButtons(h)}</div>
    </div>`;

  document.getElementById('hsCloseInfo')?.addEventListener('click', () => { closeInfo(); stopScenePulse(); });
  document.getElementById('hsNextBtn')?.addEventListener('click', nextHotspot);
  document.getElementById('hsPrevBtn')?.addEventListener('click', prevHotspot);
  hotspotInfoCard.querySelector('[data-hs-edit]')?.addEventListener('click', () => openPanel(true));
  hotspotInfoCard.querySelector('[data-hs-audio]')?.addEventListener('click', () => playHotspotAudio(h));
  hotspotInfoCard.querySelector('[data-hs-overlay]')?.addEventListener('click', () => openNestedSplat(h));
  if (Array.isArray(h.actions) && h.actions.length) {
    const body = hotspotInfoCard.querySelector('.panel-actions')?.parentElement || hotspotInfoCard;
    renderActionButtons(h, body, { hotspot: h });
  }
  renderHotspots();
  window.dispatchEvent(new CustomEvent('fumoca:hotspotOpened', { detail: { id: h.id, type: h.type, reaction: 'evidence' } }));
}

function runStoryBeat(h) {
  // After activate, auto-advance to nextId or next in list
  if (_scenePulse.storyTimer) clearTimeout(_scenePulse.storyTimer);
  const delay = Number(h.storyDelay) || 3200;
  _scenePulse.storyTimer = setTimeout(() => {
    if (h.nextId) {
      jumpToHotspotById(h.nextId);
      return;
    }
    const idx = state.hotspots.findIndex(x => x.id === h.id);
    if (idx >= 0 && idx < state.hotspots.length - 1) {
      activateHotspot(state.hotspots[idx + 1]);
    }
  }, delay);
}

function _resolveReaction(h) {
  // Map preset → concrete flags (author can still override individual flags)
  const preset = h.reaction || 'detail';
  const base = {
    fly: true,
    card: true,
    layout: 'standard',
    audio: false,
    link: false,
    overlay: false,
    keepInteractive: true,
  };
  const presets = {
    fly:          { fly: true,  card: false, layout: 'standard', audio: false, link: false, overlay: false, pulse: false, evidence: false, story: false },
    detail:       { fly: true,  card: true,  layout: 'standard', audio: false, link: false, overlay: false, pulse: false, evidence: false, story: false },
    image_detail: { fly: true,  card: true,  layout: 'side',     audio: false, link: false, overlay: false, pulse: false, evidence: false, story: false },
    audio:        { fly: true,  card: true,  layout: 'standard', audio: true,  link: false, overlay: false, pulse: false, evidence: false, story: false },
    link:         { fly: true,  card: true,  layout: 'standard', audio: false, link: true,  overlay: false, pulse: false, evidence: false, story: false },
    overlay:      { fly: true,  card: false, layout: 'standard', audio: false, link: false, overlay: true,  pulse: false, evidence: false, story: false },
    // Living Hotspots — market differentiators
    pulse_isolate:{ fly: true,  card: true,  layout: 'side',     audio: false, link: false, overlay: false, pulse: true,  evidence: false, story: false },
    evidence:     { fly: true,  card: false, layout: 'side',     audio: false, link: false, overlay: false, pulse: true,  evidence: true,  story: false },
    story_beat:   { fly: true,  card: true,  layout: 'standard', audio: false, link: false, overlay: false, pulse: false, evidence: false, story: true  },
    custom:       null,
  };
  const fromPreset = presets[preset] || presets.detail;
  if (fromPreset) {
    return {
      fly: h.flyOnActivate !== false ? fromPreset.fly : false,
      card: h.showCard !== false ? fromPreset.card : false,
      layout: h.cardLayout || fromPreset.layout,
      audio: !!(h.autoplayAudio || h.audioAutoplay || fromPreset.audio),
      link: !!(h.openLinkOnActivate || fromPreset.link),
      overlay: !!(h.overlayAutoplay || fromPreset.overlay),
      pulse: !!fromPreset.pulse,
      evidence: !!fromPreset.evidence,
      story: !!fromPreset.story,
      keepInteractive: h.keepInteractive !== false,
    };
  }
  // custom
  return {
    fly: h.flyOnActivate !== false,
    card: h.showCard !== false,
    layout: h.cardLayout || 'standard',
    audio: !!(h.autoplayAudio || h.audioAutoplay),
    link: !!h.openLinkOnActivate,
    overlay: !!h.overlayAutoplay,
    pulse: !!h.pulseIsolate,
    evidence: !!h.evidenceMode,
    story: !!h.storyBeat,
    keepInteractive: h.keepInteractive !== false,
  };
}

function activateHotspot(h) {
  const rx = _resolveReaction(h);

  // Clear previous living-hotspot effects when switching
  if (_scenePulse.storyTimer) { clearTimeout(_scenePulse.storyTimer); _scenePulse.storyTimer = null; }
  if (!rx.pulse && _scenePulse.active) stopScenePulse();

  if (rx.fly) flyToHotspot(h);

  // Living: Scene Pulse — the differentiator. Dim world, spotlight the point.
  if (rx.pulse) startScenePulse(h);

  if (rx.audio && h.audioUrl) playHotspotAudio(h);

  if (h.type === 'reveal' && h.revealTarget) {
    window.dispatchEvent(new CustomEvent('fumoca:reveal', { detail: { target: h.revealTarget, hotspot: h } }));
  }
  if (h.type === 'tour_jump' && h.nextId) jumpToHotspotById(h.nextId);

  if (rx.overlay && buildNestedSplatUrl(h)) openNestedSplat(h);

  if (rx.link) {
    const url = h.ctaLink || h.link;
    if (url) window.open(url, '_blank', 'noopener');
  }

  // Living: Spatial Evidence card (provenance / trust layer)
  if (rx.evidence) {
    openEvidenceCard(h);
  } else if (rx.card) {
    openInfo(h, { layout: rx.layout, keepInteractive: rx.keepInteractive });
  } else {
    closeInfo();
  }

  // Living: Story beat — auto-advance the narrative
  if (rx.story) runStoryBeat(h);

  track('hotspot_activate', { id: h.id, type: h.type, reaction: h.reaction || 'detail' });
}

function actionButtons(h) {
  const buttons = [];
  if (h.audioUrl) buttons.push(`<button class="e-btn e-btn-acid" data-hs-audio="${h.id}">${state.activeAudio ? 'Restart audio' : 'Play audio'}</button>`);
  if (buildNestedSplatUrl(h)) buttons.push(`<button class="e-btn e-btn-primary" data-hs-overlay="${h.id}">Open nested splat</button>`);
  if (h.ctaLink) buttons.push(`<a href="${escapeHtml(h.ctaLink)}" target="_blank" rel="noopener" class="e-btn e-btn-warn" style="text-decoration:none;display:inline-block;">${escapeHtml(h.ctaLabel || 'Open')}</a>`);
  else if (h.link) buttons.push(`<a href="${escapeHtml(h.link)}" target="_blank" rel="noopener" class="e-btn e-btn-warn" style="text-decoration:none;display:inline-block;">Open link</a>`);
  if (state.canManage) buttons.push(`<button class="e-btn e-btn-ghost" data-hs-edit="${h.id}">Edit hotspot</button><button class="e-btn e-btn-danger" data-hs-delete="${h.id}">Delete hotspot</button>`);
  if (state.hotspots.length > 1) buttons.push(`<button class="e-btn e-btn-acid" id="hsPrevBtn">← Prev</button>`);
  buttons.push(`<button class="e-btn e-btn-acid" id="hsNextBtn">Next →</button>`);
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

function openInfo(h, opts = {}) {
  state.activeId = h.id;
  const layout = opts.layout || h.cardLayout || 'standard';
  const keepInteractive = opts.keepInteractive !== false && h.keepInteractive !== false;

  hotspotInfoCard.classList.add('visible');
  hotspotInfoCard.setAttribute('aria-hidden', 'false');
  hotspotInfoCard.dataset.layout = layout;
  hotspotInfoCard.dataset.interactive = keepInteractive ? '1' : '0';

  // Layout styles — side/wide put the card out of the way so the 3D view stays usable
  if (layout === 'side' || layout === 'wide') {
    hotspotInfoCard.style.cssText = [
      'position:fixed',
      'right:16px',
      'top:72px',
      'bottom:auto',
      layout === 'wide' ? 'width:min(420px,calc(100vw - 32px))' : 'width:min(340px,calc(100vw - 32px))',
      'max-height:calc(100vh - 100px)',
      'z-index:12',
      'display:block',
      'background:rgba(7,10,16,.94)',
      'border:1px solid rgba(255,255,255,.1)',
      'border-radius:22px',
      'backdrop-filter:blur(18px)',
      'box-shadow:0 18px 70px rgba(0,0,0,.42)',
      'overflow:hidden',
      'pointer-events:auto',
    ].join(';');
  } else {
    // Reset to CSS defaults for standard bottom-right card
    hotspotInfoCard.style.cssText = '';
    hotspotInfoCard.classList.add('visible');
  }

  const sponsor = h.sponsorLabel ? `<span class="lasso-badge">Sponsor · ${escapeHtml(h.sponsorLabel)}</span>` : '';
  const product = h.productLabel ? `<span class="lasso-badge">${escapeHtml(h.productLabel)}${h.productPrice ? ` · ${escapeHtml(h.productPrice)}` : ''}</span>` : '';
  const preset = h.scenePreset ? `<span class="lasso-badge">${escapeHtml(h.scenePreset)}</span>` : '';
  const reactionBadge = h.reaction ? `<span class="lasso-badge">${escapeHtml(h.reaction)}</span>` : '';
  const idxInList = state.hotspots.findIndex(x => x.id === h.id);
  const progress = state.hotspots.length > 1
    ? `<div style="font-size:11px;color:rgba(255,255,255,.5);margin-top:2px;">${idxInList + 1} of ${state.hotspots.length}${state.tourActive ? ' · touring' : ''}</div>`
    : '';

  const mediaBlock = renderMedia(h);
  const isImageLayout = (layout === 'side' || layout === 'wide') && (h.mediaImage || h.mediaVideo);

  hotspotInfoCard.innerHTML = `
    <div style="padding:16px 16px 10px;border-bottom:1px solid rgba(255,255,255,.08);display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
      <div>
        <div style="font-family:var(--font-display);font-size:22px;line-height:1.05;color:var(--neon);letter-spacing:.04em;">${escapeHtml(h.title)}</div>
        <div style="font-size:11px;color:rgba(255,255,255,.45);margin-top:4px;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(h.type || 'info')}</div>
        ${progress}
      </div>
      <button class="ghostBtn" id="hsCloseInfo" type="button">✕</button>
    </div>
    ${h.presenterNotes ? `<div style="padding:10px 16px;background:rgba(255,209,102,.08);border-bottom:1px solid rgba(255,209,102,.15);font-size:12px;color:#ffd166;"><strong>🎤 Presenter note:</strong> ${escapeHtml(h.presenterNotes)}</div>` : ''}
    <div style="padding:14px 16px 16px;display:grid;gap:10px;max-height:min(72vh,760px);overflow:auto;">
      ${isImageLayout && mediaBlock ? `<div style="border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,.08);">${mediaBlock}</div>` : mediaBlock}
      <div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,.78);">${escapeHtml(h.description || 'Interactive focus point')}</div>
      <div class="lasso-chip-row">
        <span class="lasso-badge">Zoom ${(h.zoom || 1.12).toFixed(2)}×</span>
        ${Number.isFinite(h.wx) ? '<span class="lasso-badge">3D anchor</span>' : '<span class="lasso-badge">Screen anchor</span>'}
        ${reactionBadge}${sponsor}${product}${preset}
      </div>
      ${renderGallery(h)}
      <div class="panel-actions">${actionButtons(h)}</div>
    </div>`;

  document.getElementById('hsCloseInfo')?.addEventListener('click', closeInfo);
  document.getElementById('hsNextBtn')?.addEventListener('click', nextHotspot);
  document.getElementById('hsPrevBtn')?.addEventListener('click', prevHotspot);
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
  window.dispatchEvent(new CustomEvent('fumoca:hotspotOpened', { detail: { id: h.id, type: h.type, reaction: h.reaction || 'detail' } }));
}

function closeInfo() {
  hotspotInfoCard.classList.remove('visible');
  hotspotInfoCard.setAttribute('aria-hidden', 'true');
  hotspotInfoCard.removeAttribute('data-layout');
  hotspotInfoCard.removeAttribute('data-interactive');
  hotspotInfoCard.style.cssText = '';
  state.activeId = null;
  // Release living-hotspot scene effects when the user dismisses the card
  if (_scenePulse.active) stopScenePulse();
  if (_scenePulse.storyTimer) { clearTimeout(_scenePulse.storyTimer); _scenePulse.storyTimer = null; }
  renderHotspots();
}

function renderHotspots() {
  window._fumocaHotspots = state.hotspots.slice();
  if (!hotspotLayer) return;
  hotspotLayer.innerHTML = '';
  for (const h of state.hotspots) {
    const pos = getRenderPosition(h);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `hotspot-marker${state.activeId === h.id ? ' active pulse' : ''}`;
    el.dataset.id = h.id;
    el.dataset.type = h.type;
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    el.style.pointerEvents = 'auto';
    el.title = h.title;
    el.setAttribute('aria-label', h.title || 'Hotspot');
    el.innerHTML = `<span class="hotspot-pill">${escapeHtml(h.title)}</span>`;
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateHotspot(h);
    });
    hotspotLayer.appendChild(el);
  }
}

function _gotoTourIndex(idx) {
  if (!state.hotspots.length) return;
  const n = state.hotspots.length;
  state.tourIndex = ((idx % n) + n) % n; // handles negative wraparound too
  const h = state.hotspots[state.tourIndex];
  activateHotspot(h);
  // Manual navigation during an active tour must cancel and reschedule the
  // pending auto-advance timer from THIS position — without this, clicking
  // Next/Prev while a tour is running left the old timer armed, and it would
  // fire moments later and jump again from the position the tour thought it
  // was still at, not the one just manually selected. Confusing mid-jump for
  // a live presenter, and a real bug independent of anything added today.
  if (state.tourActive) {
    if (state.tourTimer) clearTimeout(state.tourTimer);
    state.tourTimer = setTimeout(_advanceTour, state.tourDelay);
  }
}

function nextHotspot() {
  if (!state.hotspots.length) return;
  const idx = state.activeId != null ? state.hotspots.findIndex(h => h.id === state.activeId) : state.tourIndex;
  _gotoTourIndex(idx + 1);
}

function prevHotspot() {
  if (!state.hotspots.length) return;
  const idx = state.activeId != null ? state.hotspots.findIndex(h => h.id === state.activeId) : state.tourIndex;
  _gotoTourIndex(idx - 1);
}

function stopTour() {
  state.tourActive = false;
  if (state.tourTimer) clearTimeout(state.tourTimer);
  state.tourTimer = null;
  window.dispatchEvent(new CustomEvent('fumoca:tourStopped'));
  renderPanel();
}

function _advanceTour() {
  if (!state.tourActive || !state.hotspots.length) return;
  const atEnd = state.tourIndex >= state.hotspots.length - 1;
  if (atEnd && !state.tourLoop) {
    stopTour();
    window.dispatchEvent(new CustomEvent('fumoca:tourComplete'));
    return;
  }
  state.tourIndex = (state.tourIndex + 1) % state.hotspots.length;
  activateHotspot(state.hotspots[state.tourIndex]);
  state.tourTimer = setTimeout(_advanceTour, state.tourDelay);
}

function startTour() {
  if (!state.hotspots.length) return;
  state.tourActive = true;
  state.tourIndex = -1;
  _advanceTour();
  window.dispatchEvent(new CustomEvent('fumoca:tourStarted', { detail: { count: state.hotspots.length } }));
  renderPanel();
}


function _ensurePlaceCursor() {
  let el = document.getElementById('hsPlaceCursor');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hsPlaceCursor';
    el.style.cssText = [
      'position:fixed', 'width:22px', 'height:22px', 'border-radius:999px',
      'border:2px solid rgba(200,255,0,.95)', 'background:rgba(200,255,0,.2)',
      'box-shadow:0 0 0 8px rgba(200,255,0,.1),0 0 18px rgba(200,255,0,.35)',
      'transform:translate(-50%,-50%)', 'pointer-events:none', 'z-index:40',
      'display:none', 'transition:left .04s linear,top .04s linear'
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

function _ensurePlaceHint() {
  let el = document.getElementById('hsPlaceHint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'hsPlaceHint';
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%)',
      'z-index:41', 'padding:12px 20px', 'border-radius:999px',
      'background:rgba(7,10,16,.92)', 'border:1px solid rgba(200,255,0,.35)',
      'color:#e8ff8a', 'font-size:13px', 'letter-spacing:.02em',
      'box-shadow:0 12px 40px rgba(0,0,0,.45)', 'display:none',
      'backdrop-filter:blur(12px)', 'pointer-events:none', 'max-width:90vw',
      'text-align:center'
    ].join(';');
    document.body.appendChild(el);
  }
  return el;
}

function enterPlaceMode() {
  if (!state.canManage) return;
  state.placeMode = true;
  state.editingId = null;
  state.draft = null;
  const cursor = _ensurePlaceCursor();
  const hint = _ensurePlaceHint();
  cursor.style.display = 'block';
  hint.style.display = 'block';
  hint.textContent = 'Click on the 3D object to place a hotspot · Esc to cancel';
  document.body.style.cursor = 'crosshair';
  openPanel(true);
  renderPanel();
  track('hotspot_place_mode_enter');
}

function exitPlaceMode() {
  state.placeMode = false;
  const cursor = document.getElementById('hsPlaceCursor');
  const hint = document.getElementById('hsPlaceHint');
  if (cursor) cursor.style.display = 'none';
  if (hint) hint.style.display = 'none';
  document.body.style.cursor = '';
  renderPanel();
}

function openHotspotEditor(seed, { isNew = true } = {}) {
  state.draft = normalizeHotspot(seed || {}, state.hotspots.length);
  state.editingId = isNew ? null : state.draft.id;
  state.placeMode = false;
  const cursor = document.getElementById('hsPlaceCursor');
  const hint = document.getElementById('hsPlaceHint');
  if (cursor) cursor.style.display = 'none';
  if (hint) hint.style.display = 'none';
  document.body.style.cursor = '';
  openPanel(true);
  renderPanel();
  // Focus title field after paint
  requestAnimationFrame(() => {
    document.getElementById('hsEditTitle')?.focus();
  });
}

function cancelHotspotEditor() {
  state.draft = null;
  state.editingId = null;
  exitPlaceMode();
  renderPanel();
}

async function commitHotspotEditor() {
  if (!state.draft) return;
  const form = document.getElementById('hsEditorForm');
  if (form) {
    const title = form.querySelector('[name="title"]')?.value?.trim();
    const type = (form.querySelector('[name="type"]')?.value || 'info').toLowerCase();
    const reaction = form.querySelector('[name="reaction"]:checked')?.value || 'detail';
    const description = form.querySelector('[name="description"]')?.value || '';
    const zoom = Math.max(1, Math.min(2.5, Number(form.querySelector('[name="zoom"]')?.value) || 1.12));
    const link = form.querySelector('[name="link"]')?.value?.trim() || '';
    const ctaLabel = form.querySelector('[name="ctaLabel"]')?.value?.trim() || 'Open';
    const mediaImage = form.querySelector('[name="mediaImage"]')?.value?.trim() || '';
    const audioUrl = form.querySelector('[name="audioUrl"]')?.value?.trim() || '';

    state.draft.title = title || state.draft.title || 'Hotspot';
    state.draft.type = type;
    state.draft.reaction = reaction;
    state.draft.description = description;
    state.draft.zoom = zoom;
    state.draft.link = link;
    state.draft.ctaLink = link;
    state.draft.ctaLabel = ctaLabel;
    state.draft.mediaImage = mediaImage;
    state.draft.audioUrl = audioUrl;

    // Custom flags (only meaningful when reaction === custom, but always stored)
    state.draft.flyOnActivate = !!form.querySelector('[name="flyOnActivate"]')?.checked;
    state.draft.showCard = !!form.querySelector('[name="showCard"]')?.checked;
    state.draft.autoplayAudio = !!form.querySelector('[name="autoplayAudio"]')?.checked;
    state.draft.audioAutoplay = state.draft.autoplayAudio;
    state.draft.openLinkOnActivate = !!form.querySelector('[name="openLinkOnActivate"]')?.checked;
    state.draft.keepInteractive = !!form.querySelector('[name="keepInteractive"]')?.checked;
    state.draft.cardLayout = form.querySelector('[name="cardLayout"]')?.value || 'standard';

    // Convenience presets
    if (reaction === 'image_detail') {
      state.draft.cardLayout = 'side';
      state.draft.showCard = true;
      state.draft.flyOnActivate = true;
    }
    if (reaction === 'fly') {
      state.draft.showCard = false;
    }
    if (reaction === 'audio') {
      state.draft.autoplayAudio = true;
      state.draft.audioAutoplay = true;
    }
    if (reaction === 'pulse_isolate') {
      state.draft.cardLayout = 'side';
      state.draft.showCard = true;
      state.draft.flyOnActivate = true;
      state.draft.keepInteractive = true;
    }
    if (reaction === 'evidence') {
      state.draft.cardLayout = 'side';
      state.draft.flyOnActivate = true;
    }
    if (reaction === 'story_beat') {
      state.draft.showCard = true;
      state.draft.flyOnActivate = true;
    }
  }

  const normalized = normalizeHotspot(state.draft, state.hotspots.length);
  const existingIdx = state.hotspots.findIndex((x) => x.id === normalized.id);

  if (existingIdx >= 0) {
    state.hotspots[existingIdx] = { ...state.hotspots[existingIdx], ...normalized };
  } else {
    state.hotspots.push(normalized);
  }

  state.draft = null;
  state.editingId = null;
  exitPlaceMode();
  renderHotspots();
  renderPanel();
  await saveRemote();
  activateHotspot(normalized);
  track('hotspot_saved', { id: normalized.id, type: normalized.type, reaction: normalized.reaction, isNew: existingIdx < 0 });
}

function _editorFormHtml(h) {
  const isNew = !state.editingId;
  const reaction = h.reaction || 'detail';
  const reactionOptions = [
    { id: 'fly',           label: 'Fly only',            desc: 'Camera zooms in — no card' },
    { id: 'detail',        label: 'Detail card',         desc: 'Fly + info card (default)' },
    { id: 'image_detail',  label: 'Image + detail',      desc: 'Fly + side card with large image' },
    { id: 'pulse_isolate', label: '✦ Scene Pulse',       desc: 'World dims, spotlight on the point — living focus' },
    { id: 'evidence',      label: '✦ Spatial Evidence',  desc: 'Provenance card: capture trust, dimensions, spatial ID' },
    { id: 'story_beat',    label: '✦ Story Beat',        desc: 'Fly + card, then auto-advance the narrative' },
    { id: 'audio',         label: 'Audio focus',         desc: 'Fly + autoplay audio + card' },
    { id: 'link',          label: 'Open link',           desc: 'Fly + open CTA link' },
    { id: 'overlay',       label: 'Nested splat',        desc: 'Fly + open nested 3D overlay' },
    { id: 'custom',        label: 'Custom mix',          desc: 'Pick individual behaviours below' },
  ];
  return `
    <div class="e-control" id="hsEditorForm" style="border:1px solid rgba(200,255,0,.28);background:rgba(200,255,0,.04);border-radius:16px;padding:14px;">
      <div class="e-label"><span>${isNew ? 'New hotspot' : 'Edit hotspot'}</span><span class="e-val">${Number.isFinite(h.wx) ? '3D anchor' : 'Screen anchor'}</span></div>
      <div style="display:grid;gap:10px;margin-top:10px;">
        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          Title
          <input name="title" id="hsEditTitle" value="${escapeHtml(h.title || '')}" placeholder="e.g. Driver door"
            style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:13px;">
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          Type
          <select name="type" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:13px;">
            ${['info','audio','link','tour','reveal','tour_jump','splat_overlay','product','sponsor'].map(t =>
              `<option value="${t}" ${h.type === t ? 'selected' : ''}>${t}</option>`
            ).join('')}
          </select>
        </label>

        <div style="display:grid;gap:6px;">
          <div style="font-size:11px;color:rgba(255,255,255,.55);">On-click reaction</div>
          <div style="display:grid;gap:6px;">
            ${reactionOptions.map(r => `
              <label style="display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px;border:1px solid ${reaction === r.id ? 'rgba(200,255,0,.45)' : 'rgba(255,255,255,.08)'};background:${reaction === r.id ? 'rgba(200,255,0,.08)' : 'transparent'};cursor:pointer;">
                <input type="radio" name="reaction" value="${r.id}" ${reaction === r.id ? 'checked' : ''} style="margin-top:3px;">
                <span>
                  <span style="display:block;font-size:13px;color:#fff;">${r.label}</span>
                  <span style="display:block;font-size:11px;color:rgba(255,255,255,.45);margin-top:2px;">${r.desc}</span>
                </span>
              </label>`).join('')}
          </div>
        </div>

        <div id="hsCustomFlags" style="display:${reaction === 'custom' ? 'grid' : 'none'};gap:8px;padding:10px;border-radius:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);">
          <div style="font-size:11px;color:rgba(255,255,255,.5);margin-bottom:2px;">Custom mix</div>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.8);"><input type="checkbox" name="flyOnActivate" ${h.flyOnActivate !== false ? 'checked' : ''}> Fly / zoom camera</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.8);"><input type="checkbox" name="showCard" ${h.showCard !== false ? 'checked' : ''}> Show detail card</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.8);"><input type="checkbox" name="autoplayAudio" ${h.autoplayAudio || h.audioAutoplay ? 'checked' : ''}> Autoplay audio</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.8);"><input type="checkbox" name="openLinkOnActivate" ${h.openLinkOnActivate ? 'checked' : ''}> Open link immediately</label>
          <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:rgba(255,255,255,.8);"><input type="checkbox" name="keepInteractive" ${h.keepInteractive !== false ? 'checked' : ''}> Keep 3D view interactive</label>
          <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">Card layout
            <select name="cardLayout" style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:12px;">
              <option value="standard" ${h.cardLayout === 'standard' || !h.cardLayout ? 'selected' : ''}>Standard (bottom-right)</option>
              <option value="side" ${h.cardLayout === 'side' ? 'selected' : ''}>Side panel</option>
              <option value="wide" ${h.cardLayout === 'wide' ? 'selected' : ''}>Wide side panel</option>
            </select>
          </label>
        </div>

        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          Description
          <textarea name="description" rows="3" placeholder="What should visitors know here?"
            style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:13px;resize:vertical;">${escapeHtml(h.description || '')}</textarea>
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          Zoom (${(h.zoom || 1.12).toFixed(2)}×)
          <input name="zoom" type="range" min="1" max="2.5" step="0.02" value="${h.zoom || 1.12}"
            oninput="this.previousSibling.textContent='Zoom ('+(+this.value).toFixed(2)+'×)'"
            style="width:100%;">
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          Image URL (shows large in Image + detail reaction)
          <input name="mediaImage" value="${escapeHtml(h.mediaImage || '')}" placeholder="https://…/photo.jpg"
            style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:13px;">
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          Link / CTA URL (optional)
          <input name="link" value="${escapeHtml(h.ctaLink || h.link || '')}" placeholder="https://…"
            style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:13px;">
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          CTA button label
          <input name="ctaLabel" value="${escapeHtml(h.ctaLabel || 'Open')}" placeholder="Open"
            style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:13px;">
        </label>
        <label style="display:grid;gap:4px;font-size:11px;color:rgba(255,255,255,.55);">
          Audio URL (optional)
          <input name="audioUrl" value="${escapeHtml(h.audioUrl || '')}" placeholder="https://…/clip.mp3"
            style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff;font-size:13px;">
        </label>
        <div class="panel-actions" style="margin-top:4px;display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="e-btn e-btn-acid" id="hsEditorSave">${isNew ? 'Create hotspot' : 'Save changes'}</button>
          <button type="button" class="e-btn e-btn-ghost" id="hsEditorCancel">Cancel</button>
        </div>
      </div>
    </div>`;
}

function renderPanel() {
  if (!hotspotPanel) return;
  const rows = state.hotspots.map((h) => `
    <div class="e-control" data-row="${h.id}">
      <div class="e-label"><span>${escapeHtml(h.title)}</span><span class="e-val">${escapeHtml(h.reaction || h.type || 'detail')}</span></div>
      <div class="e-note">${escapeHtml(h.description || 'No description')} · zoom ${(h.zoom || 1.12).toFixed(2)}×${h.mediaImage ? ' · image' : ''}${buildNestedSplatUrl(h) ? ' · nested splat' : ''}${h.audioUrl ? ' · audio' : ''}${h.ctaLink ? ' · cta' : ''}</div>
      <div class="panel-actions" style="margin-top:10px;">
        <button class="e-btn e-btn-acid" data-action="fly" data-id="${h.id}">Go</button>
        ${buildNestedSplatUrl(h) ? `<button class="e-btn e-btn-primary" data-action="overlay" data-id="${h.id}">Overlay</button>` : ''}
        ${state.canManage ? `<button class="e-btn e-btn-ghost" data-action="edit" data-id="${h.id}">Edit</button><button class="e-btn e-btn-ghost" data-action="animate" data-id="${h.id}">Animate part</button><button class="e-btn e-btn-danger" data-action="delete" data-id="${h.id}">Delete</button>` : ''}
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
        <button class="e-btn e-btn-ghost" id="hsPresentBtn">${document.fullscreenElement ? '🡼 Exit present' : '🎦 Present'}</button>
        <label style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:rgba(255,255,255,.6);margin-left:8px;">
          <input type="checkbox" id="hsTourLoop" ${state.tourLoop ? 'checked' : ''}> Loop
        </label>
        ${state.canManage ? (
          state.placeMode
            ? '<button class="e-btn e-btn-warn" id="hsCancelPlace">Cancel placement</button>'
            : state.draft
              ? ''
              : '<button class="e-btn e-btn-acid" id="hsAdd">＋ Add hotspot</button><button class="e-btn e-btn-ghost" id="hsCaptureCurrent">Capture current view</button><button class="e-btn e-btn-ghost" id="hsSave">Save hotspots</button>'
        ) : ''}
        <div class="e-note">${
          state.placeMode
            ? 'Click anywhere on the 3D object to drop a hotspot. Esc cancels.'
            : state.draft
              ? 'Fill in the details below, then save.'
              : 'Add hotspot → click the object to place → fill details → save. Capture current view uses the camera target. Shift+click also places.'
        }</div>
      </div>
      ${state.draft ? _editorFormHtml(state.draft) : ''}
      ${rows || '<div class="e-control"><div class="e-note">No hotspots yet.</div></div>'}
    </div>`;

  hotspotPanel.querySelector('#hsPanelClose')?.addEventListener('click', () => openPanel(false));
  hotspotPanel.querySelector('#hsNextTour')?.addEventListener('click', nextHotspot);
  hotspotPanel.querySelector('#hsToggleTour')?.addEventListener('click', () => { if (state.tourActive) stopTour(); else startTour(); });
  hotspotPanel.querySelector('#hsTourLoop')?.addEventListener('change', (e) => { state.tourLoop = e.target.checked; });
  hotspotPanel.querySelector('#hsPresentBtn')?.addEventListener('click', () => {
    // document.documentElement, not #viewerShell — #hotspotInfoCard (the
    // panel showing title/description/presenter notes/Next/Prev) lives
    // outside #viewerShell in the DOM. Fullscreening just #viewerShell would
    // make the info card vanish entirely during "Present" mode, defeating
    // the point of a presenter view.
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(err =>
      console.warn('[hotspot-pro] Fullscreen request failed:', err.message));
  });
  hotspotPanel.querySelector('#hsAdd')?.addEventListener('click', () => {
    enterPlaceMode();
  });
  hotspotPanel.querySelector('#hsCancelPlace')?.addEventListener('click', () => {
    exitPlaceMode();
  });
  hotspotPanel.querySelector('#hsCaptureCurrent')?.addEventListener('click', () => {
    const seed = getCurrentViewerAnchor();
    openHotspotEditor({ ...seed, title: `Hotspot ${state.hotspots.length + 1}` }, { isNew: true });
  });
  hotspotPanel.querySelector('#hsSave')?.addEventListener('click', async () => { await saveRemote(); renderPanel(); });
  hotspotPanel.querySelector('#hsEditorSave')?.addEventListener('click', () => { commitHotspotEditor(); });
  hotspotPanel.querySelector('#hsEditorCancel')?.addEventListener('click', () => cancelHotspotEditor());
  // Toggle custom flags panel when reaction changes
  hotspotPanel.querySelectorAll('[name="reaction"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      const custom = document.getElementById('hsCustomFlags');
      if (custom) custom.style.display = radio.value === 'custom' && radio.checked ? 'grid' : 'none';
      // Also hide when another radio is selected
      if (!radio.checked) return;
      if (custom) custom.style.display = radio.value === 'custom' ? 'grid' : 'none';
    });
  });
  hotspotPanel.querySelectorAll('[data-action="fly"]').forEach(btn => btn.addEventListener('click', () => {
    const h = state.hotspots.find(x => x.id === btn.dataset.id); if (h) activateHotspot(h);
  }));
  hotspotPanel.querySelectorAll('[data-action="overlay"]').forEach(btn => btn.addEventListener('click', () => {
    const h = state.hotspots.find(x => x.id === btn.dataset.id); if (h) openNestedSplat(h);
  }));
  hotspotPanel.querySelectorAll('[data-action="edit"]').forEach(btn => btn.addEventListener('click', () => {
    const idx = state.hotspots.findIndex(x => x.id === btn.dataset.id);
    if (idx < 0) return;
    openHotspotEditor(state.hotspots[idx], { isNew: false });
  }));
  hotspotPanel.querySelectorAll('[data-action="delete"]').forEach(btn => btn.addEventListener('click', () => {
    const idx = state.hotspots.findIndex(x => x.id === btn.dataset.id);
    if (idx < 0) return;
    if (!confirm('Delete this hotspot?')) return;
    const removedId = state.hotspots[idx].id;
    state.hotspots.splice(idx, 1);
    if (state.activeId === removedId) closeInfo();
    renderHotspots(); renderPanel();
    saveRemote();
  }));
  hotspotPanel.querySelectorAll('[data-action="animate"]').forEach(btn => btn.addEventListener('click', () => {
    const h = state.hotspots.find(x => x.id === btn.dataset.id);
    if (h) animatePartFlow(h);
  }));
}

/**
 * Real authoring flow for a "toggle this part open/closed" hotspot action —
 * see js/modules/nif-part-toggle.js for exactly what this bakes and why it's
 * a snap toggle, not smooth animation (the live viewer's third-party splat
 * library has no supported fast path for moving points post-load, and this
 * codebase already has one abandoned attempt at live blob-URL scene
 * swapping — see _fumocaApplyRendererPreview's own comment in viewer.js).
 *
 * Uses the same prompt()-based pattern as promptHotspot()/advancedPrompt()
 * elsewhere in this file, rather than introducing a new form UI style.
 */
async function animatePartFlow(h) {
  const nifUrl = window._fumocanifUrl || window._fumocaCurrentRecord?.nif_url;
  if (!nifUrl) { alert('No active .nif URL found — open a file in the viewer first.'); return; }

  // KNOWN LIMITATION, not fixed here: this toggle swaps the ENTIRE loaded
  // scene between "closed" and "open" files. If a NIF has two independently
  // animated parts (a door AND a trunk), opening the trunk swaps to a file
  // baked with ONLY the trunk rotated — which resets the door back to
  // closed, since that file was baked from the original, not from the
  // door-open variant. Simultaneous multi-part open states would need a
  // combinatorial set of baked files (door-only, trunk-only, both-open,
  // etc.) — real, buildable, but not attempted here. Fine for "one moving
  // part per file" today; flagging so it's a known tradeoff, not a surprise.

  const layer = prompt(
    'Layer to animate (must match a LAYER_GEO label from this .nif — e.g. "segment_3". ' +
    'Files reconstructed before the indices-carrying pipeline.py can\'t be animated this way.)',
    ''
  );
  if (!layer) return;

  const axisStr = prompt('Rotation axis as "x,y,z" (default 0,1,0 = vertical hinge, like a side-opening door)', '0,1,0');
  if (axisStr == null) return;
  const axis = axisStr.split(',').map(Number);
  if (axis.length !== 3 || axis.some(Number.isNaN)) { alert('Axis must be three numbers, e.g. 0,1,0'); return; }

  const angleStr = prompt('Open angle in degrees', '60');
  if (angleStr == null) return;
  const angleDeg = Number(angleStr) || 60;

  const statusBtn = hotspotPanel.querySelector(`[data-action="animate"][data-id="${h.id}"]`);
  const originalLabel = statusBtn?.textContent;
  if (statusBtn) { statusBtn.textContent = 'Baking…'; statusBtn.disabled = true; }

  try {
    const { openNifUrl, layers } = await authorPartToggle(nifUrl, layer, { axis, angleDeg });

    // Preview before committing — show the baked "open" state live via the
    // same toggle mechanism the hotspot will use, instead of saving blind
    // and only finding out it looks wrong after publishing to visitors.
    if (window._fumocaApplyRendererPreview) {
      if (statusBtn) statusBtn.textContent = 'Previewing…';
      window._fumocaApplyRendererPreview(openNifUrl);
      const looksRight = confirm(
        `Showing "${layer}" rotated ${angleDeg}° around axis [${axis.join(',')}]. ` +
        `Does this look correct?\n\nOK = save this as the hotspot's toggle action.\n` +
        `Cancel = discard and try different values.`
      );
      window._fumocaRestoreRendererPreview?.();
      if (!looksRight) {
        if (statusBtn) { statusBtn.textContent = originalLabel; statusBtn.disabled = false; }
        return;
      }
    }

    h.actions = Array.isArray(h.actions) ? h.actions : [];
    // Replace any existing animate action for this same layer on this hotspot
    // — one toggle definition per layer per hotspot, last authored wins.
    h.actions = h.actions.filter(a => !(a?.action?.type === 'animate' && a.action.layer === layer));
    h.actions.push({
      id: `animate_${layer}_${Date.now()}`,
      label: `Toggle ${layer}`,
      action: { type: 'animate', layer, openNifUrl },
    });
    await saveRemote();
    renderPanel();
    alert(`Saved. This hotspot now has a "Toggle ${layer}" button that snaps it open/closed.\n` +
      `Animatable layers found in this file: ${layers.map(l => l.label).join(', ') || '(none)'}`);
  } catch (err) {
    console.error('[hotspot-pro] animatePartFlow failed:', err);
    alert(`Could not bake the open variant: ${err.message}`);
  } finally {
    if (statusBtn) { statusBtn.textContent = originalLabel; statusBtn.disabled = false; }
  }
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
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.placeMode) { exitPlaceMode(); return; }
      if (state.draft) { cancelHotspotEditor(); return; }
      closeNestedSplat();
    }
  });
  document.addEventListener('fullscreenchange', () => renderPanel());

  // Arrow-key navigation — a standard presenter affordance (clicker/keyboard
  // during a live demo). Guarded against firing while someone is typing in
  // any text field/textarea/contenteditable elsewhere on the page, and only
  // active while the info card is actually open (state.activeId set) so it
  // doesn't hijack arrow keys used for anything else on the surrounding page.
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
    if (state.placeMode || state.draft) return;
    if (state.activeId == null || !state.hotspots.length) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); nextHotspot(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prevHotspot(); }
  });
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

  // Studio uses #viewport; viewer uses #stage / #stageHost. Listen on both + document for place mode.
  const stage =
    document.getElementById('viewport') ||
    document.getElementById('stageHost') ||
    document.getElementById('stage') ||
    document.body;

  // Track pointer so a drag-to-orbit does not accidentally place a hotspot
  let _placePtr = null;
  const onPlaceDown = (event) => {
    if (!state.placeMode) return;
    _placePtr = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const onPlaceUp = async (event) => {
    if (!state.placeMode || !state.canManage || !_placePtr) return;
    const dx = event.clientX - _placePtr.x;
    const dy = event.clientY - _placePtr.y;
    const moved = (dx * dx + dy * dy) > 36; // >6px = drag, not click
    _placePtr = null;
    if (moved) return;
    if (event.target?.closest?.('#hotspotProPanel, #hotspotInfoCard, .hotspot-marker, button, a, input, textarea, select, .panel-body, .topbar, #leftPanel, #rightPanel')) return;
    event.preventDefault();
    event.stopPropagation();
    const anchor = await captureEventHotspotAnchor(event);
    // Require a real 3D hit when possible so markers stick to the part
    if (!Number.isFinite(anchor.wx)) {
      console.warn('[hotspot-pro] placement had no 3D hit — using screen anchor only');
    }
    openHotspotEditor({
      ...anchor,
      title: `Hotspot ${state.hotspots.length + 1}`,
      type: 'info',
    }, { isNew: true });
  };
  const onPlaceMove = (event) => {
    if (!state.placeMode) return;
    const cursor = _ensurePlaceCursor();
    cursor.style.display = 'block';
    cursor.style.left = event.clientX + 'px';
    cursor.style.top = event.clientY + 'px';
  };
  stage.addEventListener('pointerdown', onPlaceDown);
  stage.addEventListener('pointerup', onPlaceUp);
  stage.addEventListener('pointercancel', () => { _placePtr = null; });
  stage.addEventListener('pointermove', onPlaceMove);
  // Also on canvas directly (OrbitControls target)
  document.querySelector('#viewport canvas')?.addEventListener('pointerdown', onPlaceDown);
  document.querySelector('#viewport canvas')?.addEventListener('pointerup', onPlaceUp);

  // Shift + double-click still places (power-user shortcut)
  stage?.addEventListener('dblclick', async (event) => {
    if (!state.canManage || !event.shiftKey) return;
    event.preventDefault();
    const anchor = await captureEventHotspotAnchor(event);
    openHotspotEditor({
      ...anchor,
      title: `Hotspot ${state.hotspots.length + 1}`,
      type: 'info',
    }, { isNew: true });
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

  // Auto-present via ?present=1 — useful for kiosk displays or a link meant
  // to auto-play a demo. Starts the tour immediately (safe — a JS timer
  // needs no user gesture). Deliberately does NOT auto-call
  // requestFullscreen() here: browsers block the Fullscreen API outside a
  // direct user gesture (click/tap), so an automatic call would just fail
  // silently and look broken. One clearly-labeled tap satisfies that
  // requirement honestly instead of pretending auto-fullscreen works.
  if (new URLSearchParams(location.search).get('present') && state.hotspots.length) {
    startTour();
    _showFullscreenPrompt();
  }
}

function _showFullscreenPrompt() {
  if (document.fullscreenElement) return;
  const btn = document.createElement('button');
  btn.textContent = '⛶ Tap for fullscreen';
  btn.setAttribute('aria-label', 'Enter fullscreen presentation mode');
  btn.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:9999;padding:10px 16px;' +
    'border-radius:10px;background:rgba(0,0,0,.75);color:#fff;border:1px solid rgba(255,255,255,.25);' +
    'font:600 13px/1 -apple-system,sans-serif;cursor:pointer;';
  btn.addEventListener('click', () => {
    document.documentElement.requestFullscreen?.().catch(err =>
      console.warn('[hotspot-pro] Fullscreen request failed:', err.message));
    btn.remove();
  });
  document.body.appendChild(btn);
}

// Public API first — so Studio buttons work even if init() is still loading
window._fumocaTour = { start: startTour, stop: stopTour, next: nextHotspot };
window._fumocaHotspots = state.hotspots.slice();
window._fumocaOpenNestedSplat = openNestedSplat;
window._fumocaHotspotPointCloudCache = pointCloudCache;
window._fumocaActivateHotspot = function (h) {
  if (!h) return;
  const normalized = normalizeHotspot(h);
  if (!state.hotspots.some((x) => x.id === normalized.id)) {
    state.hotspots.push(normalized);
  }
  activateHotspot(normalized);
};
window._fumocaReloadHotspots = function (list) {
  return loadHotspots(list);
};
window._fumocaFlyToHotspot = flyToHotspot;
window._fumocaOpenHotspotInfo = openInfo;
window._fumocaEnterPlaceMode = enterPlaceMode;
window._fumocaExitPlaceMode = exitPlaceMode;
window._fumocaOpenHotspotEditor = openHotspotEditor;
window._fumocaCaptureHotspotAtView = function () {
  const seed = getCurrentViewerAnchor();
  openHotspotEditor({ ...seed, title: `Hotspot ${state.hotspots.length + 1}` }, { isNew: true });
};
window._fumocaOpenHotspotsPanel = function () { openPanel(true); };
window._fumocaHotspotProVersion = 'living-hotspots-v2';

// Boot (never block API exposure)
Promise.resolve()
  .then(() => init())
  .catch((err) => console.error('[hotspot-pro] init failed', err));

