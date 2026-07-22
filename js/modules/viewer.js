import r2 from '../r2Client.js';
import * as GaussianSplats3D from 'https://cdn.jsdelivr.net/npm/@mkkellogg/gaussian-splats-3d@0.4.7/build/gaussian-splats-3d.module.js';
import * as THREE from 'three';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { supabase } from '../supabaseClient.js';
import { triggerRevealForViewer } from './reveal-hook.js';
import FumocDecoder from './fumoc-decoder.js';
import { decodeNif, geometryToSplatRows } from './nif-format.js';
window._fumocaSupabase = window._fumocaSupabase || supabase;

const stageEl = document.getElementById('stage');
let stageHost = document.getElementById('stageHost');
const heroBackdrop = document.getElementById('heroBackdrop');
const focusOverlay = document.getElementById('focusOverlay');
const focusFrame = document.getElementById('focusFrame');
const maskLayer = document.getElementById('maskLayer');
const lassoLayer = document.getElementById('lassoLayer');
const lassoSvg = document.getElementById('lassoSvg');
const hotspotLayer = document.getElementById('hotspotLayer');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const errorBox = document.getElementById('errorBox');
const errorMsg = document.getElementById('errorMsg');
const splatTitle = document.getElementById('splatTitle');
const splatDesc = document.getElementById('splatDesc');
const hint = document.getElementById('hint');
const teaserBtn = document.getElementById('teaserBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');
const hotspotBtn = document.getElementById('hotspotBtn');
const editModeBtn = document.getElementById('editModeBtn');
const deleteUploadBtn = document.getElementById('deleteUploadBtn');
const saveVariantBtn = document.getElementById('saveVariantBtn');
const thumbDockImg = document.getElementById('thumbDockImg');
const previewOverlay = document.getElementById('previewOverlay');
const previewVideo = document.getElementById('previewVideo');
const previewPoster = document.getElementById('previewPoster');
const syntheticTeaser = document.getElementById('syntheticTeaser');
const viewInteractiveBtn = document.getElementById('viewInteractiveBtn');
const closePreviewBtn = document.getElementById('closePreviewBtn');
const splatModeBtn = document.getElementById('splatModeBtn');
const videoModeBtn = document.getElementById('videoModeBtn');
const mediaMeta = document.getElementById('mediaMeta');
const cleanupRange = document.getElementById('cleanupRange');
const cleanupValue = document.getElementById('cleanupValue');
const sharpnessRange = document.getElementById('sharpnessRange');
const sharpnessValue = document.getElementById('sharpnessValue');
const presenceRange = document.getElementById('presenceRange');
const presenceValue = document.getElementById('presenceValue');
const focusRange = document.getElementById('focusRange');
const focusValue = document.getElementById('focusValue');
const applyStudioBtn = document.getElementById('applyStudioBtn');
const resetStudioBtn = document.getElementById('resetStudioBtn');
const shareTeaserBtn = document.getElementById('shareTeaserBtn');
const focusXRange = document.getElementById('focusXRange');
const focusXValue = document.getElementById('focusXValue');
const focusYRange = document.getElementById('focusYRange');
const focusYValue = document.getElementById('focusYValue');
const suppressionRange = document.getElementById('suppressionRange');
const suppressionValue = document.getElementById('suppressionValue');
const featherRange = document.getElementById('featherRange');
const featherValue = document.getElementById('featherValue');
const scaleRange = document.getElementById('scaleRange');
const scaleValue = document.getElementById('scaleValue');
const isolationRange = document.getElementById('isolationRange');
const isolationValue = document.getElementById('isolationValue');
const cropWidthRange = document.getElementById('cropWidthRange');
const cropWidthValue = document.getElementById('cropWidthValue');
const cropHeightRange = document.getElementById('cropHeightRange');
const cropHeightValue = document.getElementById('cropHeightValue');
const maskShapeValue = document.getElementById('maskShapeValue');
const maskOvalBtn = document.getElementById('maskOvalBtn');
const maskBoxBtn = document.getElementById('maskBoxBtn');
const presetButtons = Array.from(document.querySelectorAll('.preset-btn'));
const compareBtn = document.getElementById('compareBtn');
const modeProductBtn = document.getElementById('modeProductBtn');
const modeCarBtn = document.getElementById('modeCarBtn');
const modeRealEstateBtn = document.getElementById('modeRealEstateBtn');
const modePersonBtn = document.getElementById('modePersonBtn');
const sceneModeValue = document.getElementById('sceneModeValue');
const eraseModeBtn = document.getElementById('eraseModeBtn');
const eraseModeValue = document.getElementById('eraseModeValue');
const lassoModeBtn = document.getElementById('lassoModeBtn');
const lassoModeValue = document.getElementById('lassoModeValue');
const lassoKeepBtn = document.getElementById('lassoKeepBtn');
const lassoRemoveBtn = document.getElementById('lassoRemoveBtn');
const clearLassoBtn = document.getElementById('clearLassoBtn');
const lassoCountBadge = document.getElementById('lassoCountBadge');
const variantStateBadge = document.getElementById('variantStateBadge');
const clearMasksBtn = document.getElementById('clearMasksBtn');
const eraseSizeRange = document.getElementById('eraseSizeRange');
const eraseSizeValue = document.getElementById('eraseSizeValue');
const eraseStrengthRange = document.getElementById('eraseStrengthRange');
const eraseStrengthValue = document.getElementById('eraseStrengthValue');
const eraseOvalBtn = document.getElementById('eraseOvalBtn');
const eraseRectBtn = document.getElementById('eraseRectBtn');
const eraseShapeValue = document.getElementById('eraseShapeValue');
const cropDepthRange = document.getElementById('cropDepthRange');
const cropDepthValue = document.getElementById('cropDepthValue');
const saveVariantPanelBtn = document.getElementById('saveVariantPanelBtn');
const downloadRecipeBtn = document.getElementById('downloadRecipeBtn');
const queueMeshCleanupBtn = document.getElementById('queueMeshCleanupBtn');
const queuePrintCleanupBtn = document.getElementById('queuePrintCleanupBtn');
const saveLookBtn = document.getElementById('saveLookBtn');
const loadLookBtn = document.getElementById('loadLookBtn');
const sharpenKernel = document.getElementById('sharpenKernel');
const maskBaseRect = document.getElementById('maskBaseRect');
const maskOutsideRect = document.getElementById('maskOutsideRect');
const maskKeepEllipse = document.getElementById('maskKeepEllipse');
const maskKeepRect = document.getElementById('maskKeepRect');
const maskLassoKeepGroup = document.getElementById('maskLassoKeepGroup');
const maskEraseGroup = document.getElementById('maskEraseGroup');
const maskLassoRemoveGroup = document.getElementById('maskLassoRemoveGroup');
const cropHandles = Array.from(document.querySelectorAll('.crop-handle'));

const params = new URLSearchParams(window.location.search);
// Validate the file= param — if the file doesn't exist (400/404), ignore it
// and let the viewer fall back to splat_url from the DB record
// v92: also check sessionStorage for a pending .fumoc splat URL (from open.html handoff)
let fileUrl = await (async () => {
  // Check IndexedDB first — open.html stores the raw ArrayBuffer there
  // (sessionStorage base64 fails on files >~3.5MB due to QuotaExceededError)
  try {
    const idbBuffer = await new Promise((resolve, reject) => {
      const req = indexedDB.open('fumoca_handoff', 1);
      req.onupgradeneeded = e => e.target.result.createObjectStore('pending');
      req.onsuccess = e => {
        const db  = e.target.result;
        const tx  = db.transaction('pending', 'readwrite');
        const store = tx.objectStore('pending');
        const getReq = store.get('fumoc_file');
        getReq.onsuccess = () => {
          const buf = getReq.result;
          if (buf) {
            store.delete('fumoc_file');
            store.delete('fumoc_title');
          }
          tx.oncomplete = () => resolve(buf || null);
        };
        getReq.onerror = reject;
        tx.onerror = reject;
      };
      req.onerror = reject;
    });
    if (idbBuffer) {
      console.log('[Viewer] Reconstructing blob from IndexedDB handoff');
      const blob = new Blob([idbBuffer], { type: 'application/fumoc' });
      return URL.createObjectURL(blob);
    }
  } catch (e) {
    console.error('[Viewer] IndexedDB handoff failed:', e);
  }
  // Legacy: direct blob URL handoff (same-page context only)
  const pending = sessionStorage.getItem('fumoc_pending_splat_url');
  if (pending) {
    sessionStorage.removeItem('fumoc_pending_splat_url');
    console.log('[Viewer] Loading from sessionStorage fumoc_pending_splat_url');
    return pending;
  }
  const f = params.get('file') || '';
  if (!f) return '';
  try {
    const probe = await fetch(f, { method: 'HEAD' });
    if (!probe.ok) {
      console.warn('[Viewer] file= param returned', probe.status, '— ignoring, will use DB record');
      return '';
    }
    return f;
  } catch(e) {
    console.warn('[Viewer] file= param unreachable — ignoring');
    return '';
  }
})();
const splatId = params.get('splatId') || '';
let previewVideoUrl = params.get('previewVideo') || '';
let thumbnailUrl = params.get('thumbnail') || '';
const autoplayPreview = params.get('autoplayPreview') === '1';

// ── PUBLIC / EMBED MODE ──────────────────────────────────────────
// Detect three ways a public viewer link arrives:
//   1. ?embed=1  — explicit embed iframe
//   2. ?public=1 — explicit public share link
//   3. referrer is a different origin — brand/product page link-out
// In all cases: hide ALL admin UI immediately, before auth resolves.
const _isEmbedParam  = params.get('embed') === '1';
const _isPublicParam = params.get('public') === '1';
const _referrerOrigin = (() => {
  try { return document.referrer ? new URL(document.referrer).origin : ''; } catch (_) { return ''; }
})();
const _isExternalReferrer = !!(_referrerOrigin && _referrerOrigin !== window.location.origin);
const IS_PUBLIC_VIEWER = _isEmbedParam || _isPublicParam || _isExternalReferrer;
window.IS_PUBLIC_VIEWER = IS_PUBLIC_VIEWER;

// Return destination for the Back button:
//   ?back= param > external referrer > history.back()
const _backParam = params.get('back') || '';
const _publicBackUrl = _backParam || (_isExternalReferrer ? document.referrer : '');

if (IS_PUBLIC_VIEWER) {
  // Immediately hide every admin-only element — zero flash
  ['editModeBtn','deleteUploadBtn','saveVariantBtn',
   'studioPanel','captureToggleBtn','fourDBtn',
   'editPanel','editModeBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  document.body.classList.add('fumoca-public-viewer');

  // Wire back button to return to the originating site
  const _backBtn = document.getElementById('backBtn');
  if (_backBtn) {
    if (_publicBackUrl) {
      _backBtn.onclick = () => { window.location.href = _publicBackUrl; };
    } else if (!document.referrer) {
      // No history to go back to — hide rather than strand the user
      _backBtn.style.display = 'none';
    }
  }

  // Prevent referrer leaking the splat URL back to the brand page
  if (_isEmbedParam) {
    const _metaRef = document.createElement('meta');
    _metaRef.name = 'referrer';
    _metaRef.content = 'no-referrer';
    document.head.appendChild(_metaRef);
  }
}

// Belt-and-suspenders: re-enforce public lock after auth resolves
function _applyPublicViewerLock() {
  if (!IS_PUBLIC_VIEWER) return;
  ['editModeBtn','deleteUploadBtn','saveVariantBtn',
   'captureToggleBtn','fourDBtn','studioPanel',
   'editPanel','editModeBadge'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}
let viewerInstance = null;
let currentRecord = null;
let previewMode = 'splat';
let rendererPreviewUrl = null;
let rendererPreviewSeq = 0;
let rendererPreviewPending = false;
let stageFreezeHideTimer = null;
let stageFreezeEl = null;
let pipelineVisualTimer = null;
const originalSplatUrl = fileUrl || '';
const pipelineQueueKey = 'fumoca_pipeline_reliability_queue';
let pipelineRetryTimer = null;
const defaultStudio = { cleanup: 5, sharpness: 20, presence: 100, focus: 42, focusX: 50, focusY: 42, suppression: 24, feather: 10, scale: 100, isolation: 0, cropWidth: 36, cropHeight: 42, cropDepth: 65, maskShape: 'ellipse', sceneMode: 'product', eraseSize: 18, eraseStrength: 92, eraseShape: 'ellipse' };
const studioState = { ...defaultStudio };
let hotspotEditMode = false;
let eraseMaskMode = false;
let lassoMode = false;
let lassoAction = 'keep';
let activeLassoPoints = [];
let variantDirty = false;
let hotspots = [];
let cutoutMasks = [];
let lassoShapes = [];
let cropDragState = null;

const manageAccess = { canManage: false, role: null, userId: null, ownerId: null };

function getSessionUserId() {
  return window._fumocaSession?.user?.id || null;
}

async function detectManagePermission() {
  const userId = getSessionUserId();
  let role = window._fumocaSession?.user?.user_metadata?.role || null;
  try {
    if (supabase && userId) {
      const { data } = await supabase.from('profiles').select('id').eq('id', userId).maybeSingle();
      role = data ? role : role;
    }
  } catch (_) {}
  const ownerId = currentRecord?.user_id || currentRecord?.owner_id || currentRecord?.created_by || currentRecord?.profile_id || currentRecord?.userId || null;
  const isAdmin = ['admin', 'super_admin', 'owner'].includes(String(role || '').toLowerCase());
  manageAccess.canManage = !!(isAdmin || (userId && ownerId && userId === ownerId));
  manageAccess.role = role || null;
  manageAccess.userId = userId || null;
  manageAccess.ownerId = ownerId || null;
  window._fumocaManageAccess = { ...manageAccess };
  window.dispatchEvent(new CustomEvent('fumoca:permissionsReady', { detail: { ...manageAccess } }));
  applyManageGating();
  return manageAccess.canManage;
}

function applyManageGating() {
  const canManage = !!manageAccess.canManage;
  if (editModeBtn) editModeBtn.style.display = canManage ? '' : 'none';
  if (deleteUploadBtn) deleteUploadBtn.style.display = canManage ? '' : 'none';
  if (saveVariantBtn) saveVariantBtn.style.display = canManage ? '' : 'none';
  // Public viewer always wins — re-hide regardless of canManage
  _applyPublicViewerLock();
}

function extractStoragePath(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const u = new URL(urlString, window.location.origin);
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/) || u.pathname.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/) || u.pathname.match(/\/storage\/v1\/object\/auth\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]).replace(/^public\//,'') };
  } catch (_) { return null; }
}

async function deleteCurrentUpload() {
  if (!manageAccess.canManage || !currentRecord?.id) {
    alert('Only the owner or admin can delete this upload.');
    return;
  }
  if (!window.confirm('Delete this upload, linked files, and its processing rows?')) return;
  const btn = deleteUploadBtn;
  const original = btn?.textContent || 'Delete upload';
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    const candidates = [
      currentRecord?.splat_url, currentRecord?.file_url, currentRecord?.file, currentRecord?.thumbnail_url,
      currentRecord?.thumbnail, currentRecord?.preview_video_url, currentRecord?.previewVideo,
      currentRecord?.source_video_url, currentRecord?.video_url,
    ].filter(Boolean);
    for (const raw of candidates) {
      const hit = extractStoragePath(raw);
      if (!hit) continue;
      try { await r2.from(hit.bucket).remove([hit.path]); } catch (_) {}
    }
    try { await supabase.from('processing_jobs').delete().eq('splat_id', currentRecord.id); } catch (_) {}
    const { error } = await supabase.from('splats').delete().eq('id', currentRecord.id);
    if (error) throw error;
    window.location.href = 'feed.html';
  } catch (err) {
    console.error('[FUMOCA delete upload]', err);
    alert(`Delete failed: ${err?.message || 'unknown error'}`);
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

function firstNonEmpty(...values) { return values.find(v => typeof v === 'string' && v.trim()) || ''; }

function getHotspotStorageKey() { return `fumoca:hotspots:${splatId || fileUrl || 'default'}`; }
function getLookStorageKey() { return `fumoca:look:${splatId || fileUrl || 'default'}`; }
function getMaskStorageKey() { return `fumoca:masks:${splatId || fileUrl || 'default'}`; }
function getLassoStorageKey() { return `fumoca:lasso:${splatId || fileUrl || 'default'}`; }
function loadHotspots() {
  try { hotspots = JSON.parse(localStorage.getItem(getHotspotStorageKey()) || '[]'); } catch (_) { hotspots = []; }
}
function saveHotspots() {
  try { localStorage.setItem(getHotspotStorageKey(), JSON.stringify(hotspots)); } catch (_) {}
}
function loadCutoutMasks() {
  try { cutoutMasks = JSON.parse(localStorage.getItem(getMaskStorageKey()) || '[]'); } catch (_) { cutoutMasks = []; }
}
function saveCutoutMasks() {
  try { localStorage.setItem(getMaskStorageKey(), JSON.stringify(cutoutMasks)); } catch (_) {}
}

function loadLassoShapes() {
  try { lassoShapes = JSON.parse(localStorage.getItem(getLassoStorageKey()) || '[]'); } catch (_) { lassoShapes = []; }
}
function saveLassoShapes() {
  try { localStorage.setItem(getLassoStorageKey(), JSON.stringify(lassoShapes)); } catch (_) {}
}
function setVariantDirty(flag = true) {
  variantDirty = flag;
  if (variantStateBadge) variantStateBadge.textContent = flag ? 'Variant has unsaved changes' : 'Variant saved';
}
function setLassoAction(action) {
  lassoAction = action === 'remove' ? 'remove' : 'keep';
  lassoKeepBtn?.classList.toggle('active', lassoAction === 'keep');
  lassoRemoveBtn?.classList.toggle('active', lassoAction === 'remove');
}
function setLassoMode(enabled) {
  lassoMode = enabled;
  if (enabled) {
    setHotspotMode(false);
    setEraseMaskMode(false);
  }
  if (lassoModeBtn) lassoModeBtn.classList.toggle('active', enabled);
  if (lassoModeValue) lassoModeValue.textContent = enabled ? 'On' : 'Off';
  if (lassoLayer) lassoLayer.style.pointerEvents = enabled ? 'auto' : 'none';
}
function pointsToAttr(points) {
  return (points || []).map(p => `${Number(p.x).toFixed(2)},${Number(p.y).toFixed(2)}`).join(' ');
}
function pointsToMaskAttr(points) {
  return (points || []).map(p => `${(Number(p.x) / 100).toFixed(4)},${(Number(p.y) / 100).toFixed(4)}`).join(' ');
}
function renderLassoShapes() {
  if (!lassoSvg) return;
  lassoSvg.innerHTML = '';
  lassoSvg.setAttribute('viewBox', '0 0 100 100');
  lassoSvg.setAttribute('preserveAspectRatio', 'none');
  lassoShapes.forEach((shape, index) => {
    if (!Array.isArray(shape.points) || shape.points.length < 3) return;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', pointsToAttr(shape.points));
    poly.setAttribute('class', `lasso-poly ${shape.action === 'remove' ? 'remove' : 'keep'}`);
    poly.dataset.index = String(index);
    poly.addEventListener('click', (e) => {
      if (!lassoMode) return;
      e.stopPropagation();
      lassoShapes.splice(index, 1);
      saveLassoShapes();
      renderLassoShapes();
      updateViewerMask();
      setVariantDirty(true);
    });
    lassoSvg.appendChild(poly);
  });
  if (activeLassoPoints.length >= 2) {
    const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    ghost.setAttribute('points', pointsToAttr(activeLassoPoints));
    ghost.setAttribute('class', 'lasso-ghost');
    lassoSvg.appendChild(ghost);
  }
  if (lassoCountBadge) lassoCountBadge.textContent = `${lassoShapes.length} lasso ${lassoShapes.length === 1 ? 'shape' : 'shapes'}`;
  if (lassoLayer) lassoLayer.style.pointerEvents = lassoMode ? 'auto' : 'none';
}
function pushLassoPointFromEvent(e) {
  if (!lassoSvg) return;
  const rect = lassoSvg.getBoundingClientRect();
  const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 100);
  const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 100);
  const last = activeLassoPoints[activeLassoPoints.length - 1];
  if (!last || Math.hypot(last.x - x, last.y - y) > 0.65) activeLassoPoints.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) });
  renderLassoShapes();
}
function completeActiveLasso() {
  if (activeLassoPoints.length >= 3) {
    lassoShapes.push({ action: lassoAction, points: activeLassoPoints.slice() });
    saveLassoShapes();
    updateViewerMask();
    setVariantDirty(true);
  }
  activeLassoPoints = [];
  renderLassoShapes();
}
function cancelActiveLasso() {
  activeLassoPoints = [];
  renderLassoShapes();
}
function buildCleanupRecipe(kind = 'variant') {
  const sceneMode = studioState.sceneMode || 'product';
  return {
    version: 2,
    engine: 'fumoca-cleanup-v1',
    type: kind,
    created_at: new Date().toISOString(),
    source: {
      splat_id: splatId || currentRecord?.id || null,
      file_url: fileUrl || null,
      title: currentRecord?.title || splatTitle?.textContent || 'Untitled splat',
    },
    studio: { ...studioState },
    architecture: {
      layer_1_capture_quality: {
        mode: sceneMode,
        guided_capture_required: true,
        coverage_heatmap: true,
        blur_rejection: true,
        duplicate_frame_rejection: true,
        subject_lock: true,
      },
      layer_2_true_cleanup: {
        lasso_selection: true,
        keep_subject: lassoShapes.some(s => s.action === 'keep'),
        remove_selected: lassoShapes.some(s => s.action === 'remove') || cutoutMasks.length > 0,
        crop_cube: true,
        depth_aware_cleanup: true,
        connected_component_cleanup: true,
        density_pruning: true,
      },
      layer_3_mesh_assist: {
        mesh_cleanup_variant: kind === 'mesh_cleanup' || kind === 'print_export',
        print_export: kind === 'print_export',
        hole_fill: true,
        normal_repair: true,
        watertight_check: kind === 'print_export',
      },
      elite_editor: {
        compare_mode: true,
        direct_crop_handles: true,
        multiple_variants: true,
        undo_ready: true,
      },
      intelligence: {
        suggestions_enabled: true,
        floater_detection: true,
        sky_background_suppression: true,
        reflective_artifact_filtering: sceneMode === 'car',
      },
      vertical_profile: {
        profile: sceneMode,
        car_rules: sceneMode === 'car',
        real_estate_rules: sceneMode === 'realestate',
        object_rules: sceneMode === 'product',
        person_rules: sceneMode === 'person',
      },
      platform_pipeline: {
        save_variant_recipe: true,
        backend_pruning_job: true,
        cleaned_splat_output: true,
        cleaned_mesh_output: true,
        embed_ready: true,
      },
    },
    cleanup: {
      cutout_masks: cutoutMasks,
      lasso_shapes: lassoShapes,
      crop_cube: {
        center_x: Number(studioState.focusX || 50),
        center_y: Number(studioState.focusY || 42),
        width_pct: Number(studioState.cropWidth || 36),
        height_pct: Number(studioState.cropHeight || 42),
        depth_pct: Number(studioState.cropDepth || 65),
        shape: studioState.maskShape || 'ellipse',
      },
      selection_strategy: lassoShapes.some(s => s.action === 'keep') ? 'keep-subject-with-negative-cuts' : 'remove-selected',
    },
    requested_outputs: {
      cleaned_splat_variant: true,
      mesh_cleanup_variant: kind === 'mesh_cleanup' || kind === 'print_export',
      print_export: kind === 'print_export',
    },
  };
}
async function downloadCleanupRecipe(kind = 'variant') {
  const recipe = buildCleanupRecipe(kind);
  const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fumoca_cleanup_${kind}_${(splatId || 'local')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
}
async function saveVariantRecord(kind = 'variant') {
  const recipe = buildCleanupRecipe(kind);
  if (!supabase || !currentRecord?.id) {
    await downloadCleanupRecipe(kind);
    setVariantDirty(false);
    return { ok: true, mode: 'download' };
  }
  try {
    const title = `${currentRecord.title || 'Splat'} · ${kind === 'print_export' ? 'Print cleanup' : kind === 'mesh_cleanup' ? 'Mesh cleanup' : 'Cleaned variant'}`;
    const { error } = await supabase.from('splat_variants').insert({
      parent_splat_id: currentRecord.id,
      user_id: currentRecord.user_id,
      title,
      variant_kind: kind,
      status: 'pending',
      cleanup_recipe: recipe,
      source_splat_url: fileUrl || null,
    });
    if (error) throw error;
    setVariantDirty(false);
    return { ok: true, mode: 'supabase' };
  } catch (err) {
    console.warn('[FUMOCA variant save fallback]', err);
    await downloadCleanupRecipe(kind);
    setVariantDirty(false);
    return { ok: true, mode: 'download', error: err };
  }
}
function renderCutoutMasks() {
  if (!maskLayer) return;
  maskLayer.innerHTML = '';
  maskLayer.style.pointerEvents = eraseMaskMode ? 'auto' : 'none';
  cutoutMasks.forEach((mask, index) => {
    if (!eraseMaskMode) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cutout-hole ${mask.shape === 'rect' ? 'rect' : 'ellipse'}`;
    el.style.left = `${mask.x}%`;
    el.style.top = `${mask.y}%`;
    el.style.width = `${mask.w}%`;
    el.style.height = `${mask.h}%`;
    el.title = 'Selection stamp — click to remove';
    el.addEventListener('click', (e) => {
      if (!eraseMaskMode) return;
      e.stopPropagation();
      cutoutMasks.splice(index, 1);
      saveCutoutMasks();
      renderCutoutMasks();
      updateViewerMask();
      setVariantDirty(true);
    });
    maskLayer.appendChild(el);
  });
}
function renderHotspots() {
  if (!hotspotLayer) return;
  hotspotLayer.innerHTML = '';
  hotspotLayer.style.pointerEvents = hotspotEditMode ? 'auto' : 'none';
  hotspots.forEach((spot, index) => {
    const btn = document.createElement('button');
    btn.className = 'hotspot-marker';
    btn.style.left = `${spot.x}%`;
    btn.style.top = `${spot.y}%`;
    btn.type = 'button';
    btn.innerHTML = `<span class="hotspot-pill">${spot.title || `Hotspot ${index + 1}`}</span>`;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hotspotEditMode) {
        const action = window.prompt('Edit hotspot title, type DELETE to remove it.', spot.title || '');
        if (action === null) return;
        if (action.trim().toUpperCase() === 'DELETE') {
          hotspots.splice(index, 1);
          saveHotspots();
          renderHotspots();
          return;
        }
        hotspots[index].title = action.trim() || `Hotspot ${index + 1}`;
        saveHotspots();
        renderHotspots();
      } else if (spot.link) {
        window.open(spot.link, '_blank', 'noopener');
      } else {
        btn.classList.toggle('active');
      }
    });
    hotspotLayer.appendChild(btn);
  });
}
function setHotspotMode(enabled) {
  hotspotEditMode = enabled;
  if (enabled) {
    setEraseMaskMode(false);
    setLassoMode(false);
  }
  if (hotspotBtn) hotspotBtn.textContent = enabled ? 'Done hotspots' : 'Hotspots';
  if (hotspotBtn) hotspotBtn.classList.toggle('active', enabled);
  if (hotspotLayer) hotspotLayer.style.pointerEvents = enabled ? 'auto' : 'none';
  if (focusFrame) focusFrame.classList.toggle('visible', enabled || Number(studioState.isolation || 0) > 0);
  renderHotspots();
}
function setEraseMaskMode(enabled) {
  eraseMaskMode = enabled;
  if (enabled) {
    hotspotEditMode = false;
    setLassoMode(false);
  }
  if (eraseModeBtn) eraseModeBtn.classList.toggle('active', enabled);
  if (eraseModeValue) eraseModeValue.textContent = enabled ? 'Recipe mode' : 'Off';
  if (maskLayer) maskLayer.style.pointerEvents = enabled ? 'auto' : 'none';
  if (hotspotLayer && !hotspotEditMode) hotspotLayer.style.pointerEvents = 'none';
  renderCutoutMasks();
}

function setLoading(msg) { loadingText.textContent = msg; loadingOverlay.classList.remove('hidden'); }
function hideLoading() { loadingOverlay.classList.add('hidden'); }
function showError(msg) { hideLoading(); errorMsg.textContent = msg; errorBox.classList.add('visible'); }
function isSplatUrl(url) { const clean = String(url || '').split('?')[0].toLowerCase(); return clean.startsWith('blob:') || clean.endsWith('.ply') || clean.endsWith('.splat') || clean.endsWith('.ksplat') || clean.endsWith('.nif'); }
function _isNifUrl(url) { return String(url || '').split('?')[0].toLowerCase().endsWith('.nif'); }
// Returns url only if GaussianSplats3D can render it — strips .ply URLs completely
function _validSplatUrl(url) {
  if (!url) return '';
  // Accept .ply, .splat, .ksplat — we handle .ply ourselves via Three.js
  return url;
}
function _isPlyUrl(url) {
  return String(url || '').split('?')[0].toLowerCase().endsWith('.ply');
}
function resolveSplatUrl(record) {
  if (!record) return '';
  const candidates = [
    record.output_url, record.splat_url, record.public_url,
    record.file_url, record.external_splat_url, record.provider_splat_url
  ];
  for (const url of candidates) {
    const v = _validSplatUrl(url);
    if (v) return v;
  }
  return '';
}
function resolvePreviewVideo(record) { return record ? firstNonEmpty(record.preview_video_url, record.teaser_video_url, record.video_url) : ''; }
function resolveThumbnail(record) { return record ? firstNonEmpty(record.thumbnail_url, record.poster_url, record.preview_image_url) : ''; }
function resolvePublicTeaserUrl(record) {
  const p = new URLSearchParams();
  if (record?.id) p.set('id', record.id);
  const preview = resolvePreviewVideo(record);
  const thumb = resolveThumbnail(record);
  const splat = resolveSplatUrl(record);
  if (preview) p.set('video', preview);
  if (thumb) p.set('thumb', thumb);
  if (splat) p.set('file', splat);
  return `public-preview.html?${p.toString()}`;
}
function normalizeStatus(status, url) {
  const raw = String(status || '').toLowerCase();
  if (['done', 'ready', 'published', 'complete', 'completed'].includes(raw)) return 'done';
  if (['processing', 'running', 'training', 'rendering'].includes(raw)) return 'processing';
  if (['failed', 'error'].includes(raw)) return 'failed';
  if (raw === 'queued' || raw === 'pending') return 'queued';
  return url ? 'done' : 'queued';
}

function hydrateFromSession() {
  try {
    const raw = sessionStorage.getItem('fumoca:selectedSplat');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveCurrentLook() {
  try {
    localStorage.setItem(getLookStorageKey(), JSON.stringify(studioState));
    saveCutoutMasks();
    saveLassoShapes();
    return true;
  } catch (_) {
    return false;
  }
}
function loadSavedLook() {
  try {
    const raw = localStorage.getItem(getLookStorageKey());
    if (!raw) return false;
    Object.assign(studioState, defaultStudio, JSON.parse(raw));
    const ranges = { cleanupRange, sharpnessRange, presenceRange, focusRange, focusXRange, focusYRange, suppressionRange, featherRange, scaleRange, isolationRange, cropWidthRange, cropHeightRange, cropDepthRange, eraseSizeRange, eraseStrengthRange };
    const values = { cleanupRange:'cleanup', sharpnessRange:'sharpness', presenceRange:'presence', focusRange:'focus', focusXRange:'focusX', focusYRange:'focusY', suppressionRange:'suppression', featherRange:'feather', scaleRange:'scale', isolationRange:'isolation', cropWidthRange:'cropWidth', cropHeightRange:'cropHeight', cropDepthRange:'cropDepth', eraseSizeRange:'eraseSize', eraseStrengthRange:'eraseStrength' };
    Object.entries(values).forEach(([k, prop]) => { if (ranges[k]) ranges[k].value = String(studioState[prop]); });
    maskOvalBtn?.classList.toggle('active', studioState.maskShape !== 'inset');
    maskBoxBtn?.classList.toggle('active', studioState.maskShape === 'inset');
    eraseOvalBtn?.classList.toggle('active', studioState.eraseShape !== 'rect');
    eraseRectBtn?.classList.toggle('active', studioState.eraseShape === 'rect');
    setLassoAction(lassoAction);
    applySceneModeButtons();
    renderStudioLabels();
    loadCutoutMasks();
    loadLassoShapes();
    renderCutoutMasks();
    renderLassoShapes();
    applyStageFilters();
    setVariantDirty(false);
    return true;
  } catch (_) {
    return false;
  }
}
function applySceneModeButtons() {
  const mode = studioState.sceneMode || 'product';
  if (sceneModeValue) sceneModeValue.textContent = mode === 'realestate' ? 'Real estate' : mode.charAt(0).toUpperCase() + mode.slice(1);
  modeProductBtn?.classList.toggle('active', mode === 'product');
  modeCarBtn?.classList.toggle('active', mode === 'car');
  modeRealEstateBtn?.classList.toggle('active', mode === 'realestate');
  modePersonBtn?.classList.toggle('active', mode === 'person');
}
function setSceneMode(mode) {
  studioState.sceneMode = mode;
  applySceneModeButtons();
  if (mode === 'product') { studioState.maskShape = 'inset'; studioState.isolation = Math.max(studioState.isolation, 52); studioState.cropWidth = Math.min(studioState.cropWidth, 24); studioState.cropHeight = Math.min(studioState.cropHeight, 34); studioState.cropDepth = Math.min(studioState.cropDepth || 65, 55); studioState.suppression = Math.max(studioState.suppression, 34); }
  if (mode === 'car') { studioState.maskShape = 'inset'; studioState.isolation = Math.max(studioState.isolation, 28); studioState.cropWidth = Math.max(studioState.cropWidth, 42); studioState.cropHeight = Math.max(studioState.cropHeight, 28); studioState.cropDepth = Math.max(studioState.cropDepth || 65, 76); studioState.suppression = Math.max(studioState.suppression, 18); }
  if (mode === 'realestate') { studioState.maskShape = 'inset'; studioState.isolation = Math.max(studioState.isolation, 12); studioState.cropWidth = Math.max(studioState.cropWidth, 56); studioState.cropHeight = Math.max(studioState.cropHeight, 52); studioState.cropDepth = Math.max(studioState.cropDepth || 65, 90); studioState.suppression = Math.min(studioState.suppression, 20); }
  if (mode === 'person') { studioState.maskShape = 'ellipse'; studioState.isolation = Math.max(studioState.isolation, 42); studioState.cropWidth = Math.min(studioState.cropWidth, 24); studioState.cropHeight = Math.min(studioState.cropHeight, 32); studioState.cropDepth = Math.min(studioState.cropDepth || 65, 52); studioState.suppression = Math.max(studioState.suppression, 26); }
  maskOvalBtn?.classList.toggle('active', studioState.maskShape !== 'inset');
  maskBoxBtn?.classList.toggle('active', studioState.maskShape === 'inset');
  if (isolationRange) isolationRange.value = String(studioState.isolation);
  if (cropWidthRange) cropWidthRange.value = String(studioState.cropWidth);
  if (cropHeightRange) cropHeightRange.value = String(studioState.cropHeight);
  if (cropDepthRange) cropDepthRange.value = String(studioState.cropDepth || 65);
  if (suppressionRange) suppressionRange.value = String(studioState.suppression);
  renderStudioLabels();
  applyStageFilters();
  setVariantDirty(true);
}

async function fetchRecord() {
  if (!splatId) return null;
  const { data: splat } = await supabase.from('splats').select('*').eq('id', splatId).maybeSingle();
  if (splat) return splat;
  const { data: job } = await supabase.from('processing_jobs').select('*').eq('splat_id', splatId).maybeSingle();
  if (!job) return null;
  return {
    id: splatId,
    title: job.title || '',
    description: job.description || '',
    status: job.status || 'queued',
    splat_url: firstNonEmpty(job.output_url, job.splat_url, job.public_url, job.file_url),
    thumbnail_url: firstNonEmpty(job.thumbnail_url, job.poster_url),
    preview_video_url: firstNonEmpty(job.preview_video_url, job.video_url),
    provider_name: job.provider_name || 'FUMOCA',
    source_type: job.source_type || 'fumoca'
  };
}

async function incrementViewCount() {
  if (!splatId) return;
  try {
    const { data } = await supabase.from('splats').select('view_count').eq('id', splatId).maybeSingle();
    const currentViews = Number(data?.view_count || 0);
    await supabase.from('splats').update({ view_count: currentViews + 1 }).eq('id', splatId);
  } catch (error) {
    console.warn('[FUMOCA viewer] unable to increment view count', error);
  }
}

function applyHeader(record) {
  if (record?.title) splatTitle.textContent = record.title;
  if (record?.description) splatDesc.textContent = record.description;
  const provider = firstNonEmpty(record?.provider_name, record?.source_type === 'external' ? 'External provider' : 'FUMOCA');
  const status = normalizeStatus(record?.status, resolveSplatUrl(record));
  mediaMeta.textContent = `${provider} · ${status === 'done' ? 'Interactive ready' : status} · Feed-connected viewer`;
}

function applyThumbnailSurfaces() {
  if (!thumbnailUrl) return;
  thumbDockImg.hidden = false;
  thumbDockImg.src = thumbnailUrl;
  heroBackdrop.style.backgroundImage = `url('${thumbnailUrl.replace(/'/g, "%27")}')`;
  heroBackdrop.classList.add('visible');
  previewPoster.src = thumbnailUrl;
  previewPoster.classList.remove('hidden');
  syntheticTeaser.style.backgroundImage = `url('${thumbnailUrl.replace(/'/g, "%27")}')`;
}

function configurePreview(record) {
  previewVideoUrl = previewVideoUrl || resolvePreviewVideo(record);
  thumbnailUrl = thumbnailUrl || resolveThumbnail(record);
  window._fumocaPreviewVideoUrl = previewVideoUrl || '';
  window._fumocaThumbnailUrl = thumbnailUrl || '';
  window._fumocaPublicTeaserUrl = resolvePublicTeaserUrl(record);
  applyThumbnailSurfaces();
  if (previewVideoUrl) {
    previewVideo.src = previewVideoUrl;
    previewVideo.poster = thumbnailUrl || '';
    teaserBtn.hidden = false;
  } else if (thumbnailUrl) {
    teaserBtn.hidden = false;
  } else {
    teaserBtn.hidden = true;
  }
}

function setPreviewMode(mode) {
  previewMode = mode;
  const hasVideo = !!previewVideoUrl;
  splatModeBtn.classList.toggle('alt', mode !== 'splat');
  videoModeBtn.classList.toggle('alt', mode !== 'video');
  if (mode === 'video' && hasVideo) {
    previewVideo.classList.remove('hidden');
    previewPoster.classList.add('hidden');
    syntheticTeaser.classList.add('hidden');
    previewVideo.play().catch(() => {});
  } else {
    previewVideo.pause();
    previewVideo.classList.add('hidden');
    syntheticTeaser.classList.remove('hidden');
    previewPoster.classList.add('hidden');
  }
}

function openPreview(mode = previewMode) {
  if (!previewVideoUrl && !thumbnailUrl) return;
  previewOverlay.classList.add('visible');
  setPreviewMode(previewVideoUrl && mode === 'video' ? 'video' : 'splat');
}
function closePreview() { previewOverlay.classList.remove('visible'); previewVideo.pause(); }

function renderStudioLabels() {
  cleanupValue.textContent = String(studioState.cleanup);
  sharpnessValue.textContent = String(studioState.sharpness);
  presenceValue.textContent = `${studioState.presence}%`;
  focusValue.textContent = `${studioState.focus}%`;
  if (focusXValue) focusXValue.textContent = `${studioState.focusX}%`;
  if (focusYValue) focusYValue.textContent = `${studioState.focusY}%`;
  if (suppressionValue) suppressionValue.textContent = `${studioState.suppression}%`;
  if (featherValue) featherValue.textContent = `${studioState.feather}%`;
  if (scaleValue) scaleValue.textContent = `${studioState.scale}%`;
  if (isolationValue) isolationValue.textContent = `${studioState.isolation}%`;
  if (cropWidthValue) cropWidthValue.textContent = `${studioState.cropWidth}%`;
  if (cropHeightValue) cropHeightValue.textContent = `${studioState.cropHeight}%`;
  if (cropDepthValue) cropDepthValue.textContent = `${studioState.cropDepth || 65}%`;
  if (maskShapeValue) maskShapeValue.textContent = studioState.maskShape === 'inset' ? 'Box' : 'Oval';
  if (eraseShapeValue) eraseShapeValue.textContent = studioState.eraseShape === 'rect' ? 'Box' : 'Oval';
  if (lassoModeValue) lassoModeValue.textContent = lassoMode ? 'On' : 'Off';
  if (variantStateBadge && !variantDirty) variantStateBadge.textContent = 'Variant saved';
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function pulseStageFeedback(mode = 'edit') {
  if (!stageHost) return;
  const className = mode === 'capture' ? 'fumoca-capture-pulse' : 'fumoca-edit-pulse';
  stageHost.classList.remove('fumoca-edit-pulse', 'fumoca-capture-pulse');
  void stageHost.offsetWidth;
  stageHost.classList.add(className);
  setTimeout(() => stageHost.classList.remove(className), mode === 'capture' ? 1800 : 900);
}

function updateViewerMask() {
  if (!stageHost || !maskBaseRect || !maskEraseGroup) return;
  const isolation = Number(studioState.isolation || 0);
  const focusX = Number(studioState.focusX || 50) / 100;
  const focusY = Number(studioState.focusY || 42) / 100;
  const cropWidth = Number(studioState.cropWidth || 36) / 100;
  const cropHeight = Number(studioState.cropHeight || 42) / 100;
  const keepLassoShapes = lassoShapes.filter(shape => shape.action === 'keep' && Array.isArray(shape.points) && shape.points.length >= 3);
  const removeLassoShapes = lassoShapes.filter(shape => shape.action === 'remove' && Array.isArray(shape.points) && shape.points.length >= 3);
  const hasEraseMasks = cutoutMasks.length > 0 || removeLassoShapes.length > 0;
  const useKeepMask = isolation > 0 || keepLassoShapes.length > 0;
  maskBaseRect.setAttribute('fill', useKeepMask ? 'black' : 'white');
  maskOutsideRect.setAttribute('width', '0');
  maskOutsideRect.setAttribute('height', '0');
  maskKeepEllipse.setAttribute('cx', String(focusX));
  maskKeepEllipse.setAttribute('cy', String(focusY));
  maskKeepEllipse.setAttribute('rx', String(cropWidth));
  maskKeepEllipse.setAttribute('ry', String(cropHeight));
  maskKeepRect.setAttribute('x', String(clamp(focusX - cropWidth, 0, 1)));
  maskKeepRect.setAttribute('y', String(clamp(focusY - cropHeight, 0, 1)));
  maskKeepRect.setAttribute('width', String(clamp(cropWidth * 2, 0, 1)));
  maskKeepRect.setAttribute('height', String(clamp(cropHeight * 2, 0, 1)));
  const radius = Math.max(0.01, (34 - isolation / 3) / 100);
  maskKeepRect.setAttribute('rx', String(radius));
  maskKeepRect.setAttribute('ry', String(radius));
  maskKeepEllipse.setAttribute('fill', useKeepMask && studioState.maskShape !== 'inset' ? 'white' : 'black');
  maskKeepRect.setAttribute('fill', useKeepMask && studioState.maskShape === 'inset' ? 'white' : 'black');
  if (maskLassoKeepGroup) maskLassoKeepGroup.innerHTML = '';
  if (maskEraseGroup) maskEraseGroup.innerHTML = '';
  if (maskLassoRemoveGroup) maskLassoRemoveGroup.innerHTML = '';
  for (const shape of keepLassoShapes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    node.setAttribute('points', pointsToMaskAttr(shape.points));
    node.setAttribute('fill', 'white');
    maskLassoKeepGroup?.appendChild(node);
  }
  for (const mask of cutoutMasks) {
    const x = Number(mask.x || 50) / 100;
    const y = Number(mask.y || 50) / 100;
    const w = Number(mask.w || 18) / 100;
    const h = Number(mask.h || 18) / 100;
    const node = document.createElementNS('http://www.w3.org/2000/svg', mask.shape === 'rect' ? 'rect' : 'ellipse');
    if (mask.shape === 'rect') {
      node.setAttribute('x', String(clamp(x - w / 2, 0, 1)));
      node.setAttribute('y', String(clamp(y - h / 2, 0, 1)));
      node.setAttribute('width', String(clamp(w, 0, 1)));
      node.setAttribute('height', String(clamp(h, 0, 1)));
      node.setAttribute('rx', '0.02');
      node.setAttribute('ry', '0.02');
    } else {
      node.setAttribute('cx', String(x));
      node.setAttribute('cy', String(y));
      node.setAttribute('rx', String(w / 2));
      node.setAttribute('ry', String(h / 2));
    }
    node.setAttribute('fill', 'black');
    maskEraseGroup.appendChild(node);
  }
  for (const shape of removeLassoShapes) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    node.setAttribute('points', pointsToMaskAttr(shape.points));
    node.setAttribute('fill', 'black');
    maskLassoRemoveGroup?.appendChild(node);
  }
  const maskActive = useKeepMask || hasEraseMasks;
  stageHost.style.webkitMaskImage = 'none';
  stageHost.style.maskImage = 'none';
  stageHost.style.webkitMaskRepeat = 'no-repeat';
  stageHost.style.maskRepeat = 'no-repeat';
  stageHost.style.webkitMaskSize = '100% 100%';
  stageHost.style.maskSize = '100% 100%';
  stageHost.style.clipPath = 'none';
  stageHost.dataset.cleanupRecipeOnly = hasEraseMasks ? 'true' : 'false';
  pulseStageFeedback('edit');
}

function syncCropFromPointer(clientX, clientY, handle = 'move') {
  const rect = window.innerWidth || 1;
  const rectH = window.innerHeight || 1;
  const xPct = clamp((clientX / rect) * 100, 8, 92);
  const yPct = clamp((clientY / rectH) * 100, 8, 92);
  if (handle === 'move') {
    studioState.focusX = xPct;
    studioState.focusY = yPct;
  } else {
    const dx = Math.abs(xPct - Number(studioState.focusX || 50));
    const dy = Math.abs(yPct - Number(studioState.focusY || 42));
    studioState.cropWidth = clamp(dx, 12, 70);
    studioState.cropHeight = clamp(dy, 12, 80);
  }
  if (focusXRange) focusXRange.value = String(Math.round(studioState.focusX));
  if (focusYRange) focusYRange.value = String(Math.round(studioState.focusY));
  if (cropWidthRange) cropWidthRange.value = String(Math.round(studioState.cropWidth));
  if (cropHeightRange) cropHeightRange.value = String(Math.round(studioState.cropHeight));
  if (Number(studioState.isolation || 0) === 0) studioState.isolation = 40;
  if (isolationRange) isolationRange.value = String(Math.round(studioState.isolation));
  applyStageFilters();
  setVariantDirty(true);
}

function applyStageFilters() {
  const sharpness = Number(studioState.sharpness || 0);
  const presence = Number(studioState.presence || 100) / 100;
  const focus = Number(studioState.focus || 42);
  const focusX = Number(studioState.focusX || 50);
  const focusY = Number(studioState.focusY || 42);
  const suppression = Number(studioState.suppression || 24);
  const feather = Number(studioState.feather || 10);
  const scale = Number(studioState.scale || 100) / 100;
  const kernelCenter = (5 + (sharpness / 100) * 4).toFixed(2);
  sharpenKernel.setAttribute('kernelMatrix', `0 -1 0 -1 ${kernelCenter} -1 0 -1 0`);
  stageEl.style.filter = `url(#splatSharpen) contrast(${(1 + (presence - 1) * 0.8).toFixed(2)}) saturate(${(1 + (presence - 1) * 0.7).toFixed(2)}) brightness(${(1 + (presence - 1) * 0.18).toFixed(2)})`;
  document.documentElement.style.setProperty('--focus-size', `${focus}%`);
  document.documentElement.style.setProperty('--focus-x', `${focusX}%`);
  document.documentElement.style.setProperty('--focus-y', `${focusY}%`);
  document.documentElement.style.setProperty('--focus-feather', `${feather}%`);
  document.documentElement.style.setProperty('--focus-opacity', `${Math.max(0.08, (70 - focus) / 180).toFixed(2)}`);
  document.documentElement.style.setProperty('--outer-opacity', `${(suppression / 100).toFixed(2)}`);
  document.documentElement.style.setProperty('--subject-scale', `1`);
  document.documentElement.style.setProperty('--subject-shift-x', `0px`);
  document.documentElement.style.setProperty('--subject-shift-y', `0px`);
  const cropWidth = Number(studioState.cropWidth || 36);
  const cropHeight = Number(studioState.cropHeight || 42);
  const isolation = Number(studioState.isolation || 0);
  const maskShape = studioState.maskShape || 'ellipse';
  document.documentElement.style.setProperty('--crop-width', `${cropWidth * 2}%`);
  document.documentElement.style.setProperty('--crop-height', `${cropHeight * 2}%`);
  document.documentElement.style.setProperty('--crop-radius', `${Math.max(0, 34 - isolation / 3)}px`);
  renderCutoutMasks();
  renderLassoShapes();
  updateViewerMask();
  if (focusFrame) {
    focusFrame.classList.toggle('box', maskShape === 'inset');
    focusFrame.style.left = `${focusX}%`;
    focusFrame.style.top = `${focusY}%`;
    focusFrame.style.width = `${cropWidth * 2}%`;
    focusFrame.style.height = `${cropHeight * 2}%`;
    focusFrame.classList.toggle('visible', hotspotEditMode);
  }
  focusOverlay.style.opacity = isolation > 0 ? String(Math.min(1, 0.45 + isolation / 120)) : '1';
  if (thumbnailUrl) {
    heroBackdrop.style.opacity = String(Math.min(0.38, 0.14 + (presence - 1) * 0.14 + (suppression / 300)));
  }
  renderStudioLabels();
}

function ensureStageFreeze() {
  if (stageFreezeEl?.isConnected) return stageFreezeEl;
  const img = document.createElement('img');
  img.id = 'fumocaStageFreeze';
  Object.assign(img.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%', objectFit: 'cover',
    pointerEvents: 'none', zIndex: '6', opacity: '0', transition: 'opacity 180ms ease'
  });
  stageEl?.appendChild(img);
  stageFreezeEl = img;
  return img;
}

function showStageFreeze() {
  try {
    const canvas = window._fumocaCaptureCanvas || stageHost?.querySelector?.('canvas') || stageEl?.querySelector?.('canvas');
    if (!canvas || typeof canvas.toDataURL !== 'function') return false;
    const img = ensureStageFreeze();
    img.src = canvas.toDataURL('image/jpeg', 0.86);
    requestAnimationFrame(() => { img.style.opacity = '1'; });
    return true;
  } catch (_) { return false; }
}

function hideStageFreeze(delay = 140) {
  if (!stageFreezeEl) return;
  clearTimeout(stageFreezeHideTimer);
  stageFreezeHideTimer = setTimeout(() => { if (stageFreezeEl) stageFreezeEl.style.opacity = '0'; }, Math.max(0, delay));
}

function _fumocaShowPipelineIllusion(message = 'Processing cleanup…', ms = 2200) {
  clearTimeout(pipelineVisualTimer);
  if (hint) {
    hint.textContent = message;
    hint.classList.remove('hidden');
  }
  const beatA = Math.max(500, Math.min(ms - 700, 900));
  const beatB = Math.max(900, Math.min(ms - 250, 1700));
  if (hint && ms > 1400) {
    setTimeout(() => { if (hint && !hint.classList.contains('hidden')) hint.textContent = 'Refining depth and edges…'; }, beatA);
    setTimeout(() => { if (hint && !hint.classList.contains('hidden')) hint.textContent = 'Locking final result…'; }, beatB);
  }
  pipelineVisualTimer = setTimeout(() => {
    if (hint) hint.classList.add('hidden');
  }, ms);
}

function rebuildStageHost() {
  const next = document.createElement('div');
  next.id = 'stageHost';
  next.style.position = 'absolute';
  next.style.inset = '0';
  if (stageHost && stageHost.parentNode === stageEl) {
    stageEl.replaceChild(next, stageHost);
  } else {
    stageEl.appendChild(next);
  }
  stageHost = next;
}

async function destroyViewer() {
  const instance = viewerInstance;
  viewerInstance = null;
  if (!instance) { rebuildStageHost(); return; }
  try { instance.stop?.(); } catch (_) {}
  try { await instance.dispose?.(); } catch (_) {}
  try { instance.renderer?.domElement?.remove?.(); } catch (_) {}
  rebuildStageHost();
}

function getActiveSplatUrl() {
  return rendererPreviewUrl || fileUrl || originalSplatUrl || '';
}


// ── PLY point cloud viewer using Three.js ────────────────────────────────────
// Called when fileUrl is a .ply — renders via THREE.js with Gaussian shader
let _plyRenderer = null, _plyScene = null, _plyCamera = null, _plyControls = null, _plyFrame = null;

function destroyPlyViewer() {
  if (_plyFrame) { cancelAnimationFrame(_plyFrame); _plyFrame = null; }
  if (_plyRenderer) { _plyRenderer.dispose(); _plyRenderer.domElement.remove(); _plyRenderer = null; }
  _plyScene = _plyCamera = _plyControls = null;
}

async function mountPlyViewer(url) {
  destroyPlyViewer();
  const container = stageHost || stageEl;
  _plyScene = new THREE.Scene();
  _plyCamera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.001, 2000);
  // nerfstudio/COLMAP uses OpenCV convention: Y is DOWN, Z into scene.
  // Match the GaussianSplats3D cameraUp of [0,-1,-0.6] so splats sit upright.
  _plyCamera.up.set(0, -1, -0.6).normalize();
  _plyRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  _plyRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _plyRenderer.setSize(container.clientWidth, container.clientHeight);
  _plyRenderer.setClearColor(0x000000, 0);
  Object.assign(_plyRenderer.domElement.style, { position:'absolute', inset:'0', width:'100%', height:'100%', zIndex:'2' });
  container.appendChild(_plyRenderer.domElement);
  _plyControls = new OrbitControls(_plyCamera, _plyRenderer.domElement);
  _plyControls.enableDamping = true; _plyControls.dampingFactor = 0.07;
  _plyControls.rotateSpeed = 0.55; _plyControls.zoomSpeed = 1.1;

  setLoading('Loading point cloud…');
  try {
    // Fetch manually so PLYLoader.parse() can access ALL attributes including f_dc_*
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('fetch for "' + url + '" responded with ' + resp.status + ':');
    const buffer = await resp.arrayBuffer();
    const geo = new PLYLoader().parse(buffer);
    const posAttr = geo.getAttribute('position');
    if (!posAttr) throw new Error('PLY has no position attribute');
    const count = posAttr.count;
    const colors = new Float32Array(count * 3);

    // Try colour sources in priority order
    const fdc0 = geo.getAttribute('f_dc_0');
    const fdc1 = geo.getAttribute('f_dc_1');
    const fdc2 = geo.getAttribute('f_dc_2');
    const colAttr = geo.getAttribute('color');
    const rAttr = geo.getAttribute('red') || geo.getAttribute('diffuse_red');
    const gAttr = geo.getAttribute('green') || geo.getAttribute('diffuse_green');
    const bAttr = geo.getAttribute('blue') || geo.getAttribute('diffuse_blue');

    if (fdc0 && fdc1 && fdc2) {
      // nerfstudio/gsplat: SH DC band → sigmoid colour
      const SH = 0.28209479177387814;
      for (let i = 0; i < count; i++) {
        colors[i*3]   = Math.max(0, Math.min(1, SH * fdc0.array[i] + 0.5));
        colors[i*3+1] = Math.max(0, Math.min(1, SH * fdc1.array[i] + 0.5));
        colors[i*3+2] = Math.max(0, Math.min(1, SH * fdc2.array[i] + 0.5));
      }
    } else if (colAttr) {
      const arr = colAttr.array;
      let maxVal = 0;
      for (let i = 0; i < Math.min(arr.length, 600); i++) maxVal = Math.max(maxVal, arr[i]);
      const scale = maxVal > 1.5 ? 1/255 : 1;
      for (let i = 0; i < count * 3; i++) colors[i] = arr[i] * scale;
    } else if (rAttr && gAttr && bAttr) {
      let maxVal = 0;
      for (let i = 0; i < Math.min(rAttr.array.length, 300); i++)
        maxVal = Math.max(maxVal, rAttr.array[i], gAttr.array[i], bAttr.array[i]);
      const scale = maxVal > 1.5 ? 1/255 : 1;
      for (let i = 0; i < count; i++) {
        colors[i*3]   = rAttr.array[i] * scale;
        colors[i*3+1] = gAttr.array[i] * scale;
        colors[i*3+2] = bAttr.array[i] * scale;
      }
    } else {
      // No colour data — warm grey (not white)
      for (let i = 0; i < count; i++) { colors[i*3]=0.65; colors[i*3+1]=0.60; colors[i*3+2]=0.55; }
    }
    // ── Per-point opacity (sigmoid-decoded from log-odds if present) ──────────
    const opacities = new Float32Array(count);
    const opAttr = geo.getAttribute('opacity');
    if (opAttr) {
      for (let i = 0; i < count; i++) {
        const v = opAttr.array[i];
        opacities[i] = Number.isFinite(v) ? 1.0 / (1.0 + Math.exp(-v)) : 1.0;
      }
    } else {
      opacities.fill(1.0);
    }

    // ── Per-point size: scale_* from 3DGS are log-scale world units ──────────
    // exp-decoded they are tiny (0.001–0.15). Use scene radius to compute a
    // sensible base size so splats are always visible, with scale as a soft multiplier.
    const sizes = new Float32Array(count);
    const sc0 = geo.getAttribute('scale_0');
    const sc1 = geo.getAttribute('scale_1');
    const sc2 = geo.getAttribute('scale_2');

    // We don't know the radius yet (computed after), so store raw for now;
    // we'll rescale below after boundingSphere is computed.
    if (sc0 && sc1 && sc2) {
      for (let i = 0; i < count; i++) {
        const sx = Math.exp(Math.max(-10, Math.min(2, sc0.array[i])));
        const sy = Math.exp(Math.max(-10, Math.min(2, sc1.array[i])));
        const sz = Math.exp(Math.max(-10, Math.min(2, sc2.array[i])));
        sizes[i] = (sx + sy + sz) / 3;
      }
    } else {
      sizes.fill(0); // will be set to radius-based default below
    }

    // Debug: log what attributes are present so we can confirm colour source
    console.log('%c[FUMOCA PLY attrs]', 'color:#c8ff00;font-weight:800',
      [...geo.attributes].map ? 'n/a' :
      Object.keys(geo.attributes).join(', '));

    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

    // ── Photoreal Gaussian splat shader ───────────────────────────────────────
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uBaseSize:   { value: 1.0 },   // set after boundingSphere below
        uBrightness: { value: 1.3 },
      },
      vertexShader: /* glsl */`
        attribute vec3  color;
        attribute float aOpacity;
        attribute float aSize;
        varying vec3  vColor;
        varying float vAlpha;
        uniform float uBaseSize;
        uniform float uBrightness;
        void main() {
          vColor = clamp(color * uBrightness, 0.0, 1.0);
          vAlpha = clamp(aOpacity, 0.0, 1.0);
          vec4 mv   = modelViewMatrix * vec4(position, 1.0);
          float dist = max(0.1, -mv.z);
          // aSize is the normalised per-point multiplier (0–1 range after rescaling).
          // uBaseSize encodes the scene-radius-relative splat diameter in pixels.
          float sz = uBaseSize * (0.4 + aSize * 0.6);
          gl_PointSize = clamp(sz / dist * 80.0, 1.5, 60.0);
          gl_Position  = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec3  vColor;
        varying float vAlpha;
        void main() {
          vec2  uv = gl_PointCoord - 0.5;
          float r2 = dot(uv, uv);
          if (r2 > 0.25) discard;
          // Gaussian falloff gives smooth splat discs
          float a = exp(-7.0 * r2) * vAlpha;
          if (a < 0.006) discard;
          gl_FragColor = vec4(vColor, a);
        }`,
      transparent: true,
      depthWrite:  false,
      depthTest:   true,
      blending:    THREE.NormalBlending,
      vertexColors: false,
    });
    const pts = new THREE.Points(geo, mat);
    _plyScene.add(pts);

    // Auto-fit camera — match nerfstudio convention used by GaussianSplats3D:
    // cameraUp=[0,-1,-0.6], initialCameraPosition=[0,1,4], lookAt=[0,0,0]
    // Offset everything by the bounding center so the subject is centered.
    geo.computeBoundingSphere();
    const r = geo.boundingSphere.radius || 1;
    const c = geo.boundingSphere.center;

    // Normalise per-point sizes to 0–1 range using the median as anchor,
    // then set uBaseSize so splats cover ~0.8% of the scene radius at 1× distance.
    const sArr = geo.getAttribute('aSize').array;
    const sorted = Float32Array.from(sArr).sort();
    const median = sorted[Math.floor(sorted.length * 0.5)] || 1;
    if (median > 0) {
      for (let i = 0; i < sArr.length; i++) sArr[i] = Math.min(sArr[i] / (median * 4), 1.0);
      geo.getAttribute('aSize').needsUpdate = true;
    }
    mat.uniforms.uBaseSize.value = r * 0.9;

    // Mirror GS3D's default: sit slightly above (in nerfstudio Y-down space, "above" is negative Y)
    // and back along Z, looking at center
    _plyCamera.position.set(c.x, c.y - r * 0.25, c.z + r * 2.4);
    _plyCamera.lookAt(c.x, c.y, c.z);
    _plyControls.target.set(c.x, c.y, c.z);
    _plyControls.minDistance = r * 0.05;
    _plyControls.maxDistance = r * 14;
    _plyControls.update();
    hideLoading();
    // v78 — cinematic dots→splats reveal (per-embed via ?reveal_duration=, etc)
    triggerRevealForViewer({ material: mat, pointsMesh: pts });
    // Expose material for the social-recorder's re-trigger path
    window.__fumocaViewerMaterial = mat;
    window.addEventListener('resize', () => {
      if (!_plyRenderer) return;
      _plyCamera.aspect = container.clientWidth / container.clientHeight;
      _plyCamera.updateProjectionMatrix();
      _plyRenderer.setSize(container.clientWidth, container.clientHeight);
    });
    function loop() {
      _plyFrame = requestAnimationFrame(loop);
      _plyControls.update();
      _plyRenderer.render(_plyScene, _plyCamera);
    }
    loop();
    console.log('%c[Viewer] PLY loaded — ' + posAttr.count + ' Gaussians', 'color:#c8ff00;font-weight:800');
  } catch(e) {
    hideLoading();
    showError('Failed to load PLY: ' + e.message);
  }
}

async function mountInteractiveViewer(forceReload = false) {
  const activeUrl = getActiveSplatUrl();
  if ((!forceReload && viewerInstance) || !activeUrl) return;
  if (forceReload) { rendererPreviewPending = true; showStageFreeze(); _fumocaShowPipelineIllusion('Applying edits…', 1680); }
  if (forceReload) await destroyViewer();
  setLoading(forceReload ? 'Refreshing cleanup…' : 'Loading interactive splat…');

  try {
    viewerInstance = new GaussianSplats3D.Viewer({
      rootElement: stageHost || stageEl,
      cameraUp: [0, -1, -0.6],
      initialCameraPosition: [0, 1, 4],
      initialCameraLookAt: [0, 0, 0],
      sharedMemoryForWorkers: false,
      antialiased: true,
      selfDrivenMode: true,
      useBuiltInControls: true,
      ignoreDevicePixelRatio: false,
      dynamicScene: false,
    });
    const _activeUrl = getActiveSplatUrl();
    // For blob URLs, GaussianSplats3D can't infer format from URL — pass it explicitly
    const _sceneOpts = {
      showLoadingUI: false,
      progressiveLoad: true,
      splatAlphaRemovalThreshold: Number(studioState.cleanup || 5),
    };
    if (String(_activeUrl).startsWith('blob:')) {
      // Force .splat format — blob URLs from fumoc decoding are always raw .splat binary
      // GaussianSplats3D.SceneFormat: Ply=0, Splat=1, KSplat=2
      _sceneOpts.format = GaussianSplats3D.SceneFormat?.Splat ?? 1;
    }
    await viewerInstance.addSplatScene(_activeUrl, _sceneOpts);
    viewerInstance.start();
    hideLoading();
    hideStageFreeze(forceReload ? 220 : 90);
    rendererPreviewPending = false;
    applyStageFilters();
    setTimeout(() => hint.classList.add('hidden'), 4500);
    if (!forceReload) await incrementViewCount();

    // ── Post-load: extract Gaussian positions and fire fumoca:viewerReady ──
    // GaussianSplats3D doesn't expose positions synchronously — wait one frame
    // for the internal sort worker to finish, then probe the splatMesh.
    setTimeout(() => {
      try {
        // Extract position data from the GaussianSplats3D viewer instance
        let positions = null;
        const splatMesh = viewerInstance.splatMesh || viewerInstance.getSplatMesh?.();
        if (splatMesh) {
          // Try the sorted positions buffer first (most accurate)
          const geo = splatMesh.geometry;
          const posAttr = geo?.attributes?.position || geo?.attributes?.splatPosition;
          if (posAttr?.array) {
            positions = posAttr.array; // Float32Array, stride 3
          }
          // Fallback: read from splatBuffer directly
          if (!positions && splatMesh.splatBuffer) {
            const buf = splatMesh.splatBuffer;
            const N = buf.getSplatCount?.() || 0;
            if (N > 0) {
              positions = new Float32Array(N * 3);
              for (let i = 0; i < N; i++) {
                positions[i*3]   = buf.getX?.(i) ?? 0;
                positions[i*3+1] = buf.getY?.(i) ?? 0;
                positions[i*3+2] = buf.getZ?.(i) ?? 0;
              }
            }
          }
        }

        // Build _fumocaCurrentGaussians from positions so AutoFix and shim work
        if (positions && positions.length >= 3) {
          const N = Math.floor(positions.length / 3);
          window._fumocaCurrentGaussians = {
            N,
            posX: positions.filter((_, i) => i % 3 === 0),
            posY: positions.filter((_, i) => i % 3 === 1),
            posZ: positions.filter((_, i) => i % 3 === 2),
          };
          console.log(`%c[Viewer] _fumocaCurrentGaussians populated: ${N.toLocaleString()} Gaussians`, 'color:#c8ff00;font-weight:700');
        }

        // Expose camera and controls for AutoFix
        const cam      = viewerInstance.camera;
        const controls = viewerInstance.controls || viewerInstance.orbitControls;
        if (cam)      window._fumocaViewerCamera   = cam;
        if (controls) window._fumocaViewerControls = controls;
        window._fumocaRenderer = {
          getPositions: () => positions,
          camera:   cam,
          controls: controls,
        };

        // Fire fumoca:viewerReady — triggers AutoFix camera fit and shim population
        window.dispatchEvent(new CustomEvent('fumoca:viewerReady', {
          detail: {
            viewer:    viewerInstance,
            camera:    cam,
            controls:  controls,
            gaussians: window._fumocaCurrentGaussians,
          }
        }));

        console.log('[Viewer] fumoca:viewerReady dispatched');
      } catch (hookErr) {
        console.warn('[Viewer] post-load hook failed:', hookErr);
        // Still fire viewerReady so AutoFix can at least reset the camera
        window.dispatchEvent(new CustomEvent('fumoca:viewerReady', {
          detail: { viewer: viewerInstance }
        }));
      }
    }, 800); // 800ms — enough for first sort pass to complete
  } catch (err) {
    rendererPreviewPending = false;
    console.error('[FUMOCA viewer]', err);
    const msg = String(err?.message || err || 'unknown error');
    // Blob preview loads can fail because the viewer library infers format from the URL string.
    // Fall back gracefully to the original viewer instead of leaving edit mode looking dead.
    if (String(activeUrl).startsWith('blob:') && /File format not supported/i.test(msg)) {
      try {
        rendererPreviewSeq += 1;
        _fumocaClearRendererPreview();
        showError('Live renderer preview is limited on this viewer build. Edit overlay remains active; save a variant to apply the cleaned splat.');
        await mountInteractiveViewer(true);
        return;
      } catch (_) {}
    }
    showError(`Failed to load splat: ${msg}`);
  }
}

function activatePreset(name) {
  const presets = {
    balanced: { cleanup: 5, sharpness: 20, presence: 100, focus: 42, focusX: 50, focusY: 42, suppression: 24, feather: 10, scale: 100, isolation: 0, cropWidth: 36, cropHeight: 42, cropDepth: 65, maskShape: 'ellipse', sceneMode: 'product' },
    hero: { cleanup: 12, sharpness: 26, presence: 108, focus: 34, focusX: 50, focusY: 40, suppression: 30, feather: 9, scale: 108, isolation: 32, cropWidth: 28, cropHeight: 36, cropDepth: 60, maskShape: 'ellipse', sceneMode: 'product' },
    crisp: { cleanup: 12, sharpness: 48, presence: 118, focus: 36, focusX: 50, focusY: 42, suppression: 32, feather: 8, scale: 104, isolation: 52, cropWidth: 24, cropHeight: 32, cropDepth: 48, maskShape: 'inset', sceneMode: 'product' },
    cinematic: { cleanup: 16, sharpness: 28, presence: 112, focus: 30, focusX: 50, focusY: 38, suppression: 36, feather: 14, scale: 110, isolation: 64, cropWidth: 22, cropHeight: 30, cropDepth: 54, maskShape: 'ellipse', sceneMode: 'product' },
    person: { cleanup: 8, sharpness: 24, presence: 106, focus: 34, focusX: 50, focusY: 34, suppression: 26, feather: 12, scale: 108, isolation: 46, cropWidth: 22, cropHeight: 30, cropDepth: 46, maskShape: 'ellipse', sceneMode: 'person' },
  };
  Object.assign(studioState, presets[name] || presets.balanced);
  cleanupRange.value = String(studioState.cleanup);
  sharpnessRange.value = String(studioState.sharpness);
  presenceRange.value = String(studioState.presence);
  focusRange.value = String(studioState.focus);
  if (focusXRange) focusXRange.value = String(studioState.focusX);
  if (focusYRange) focusYRange.value = String(studioState.focusY);
  if (suppressionRange) suppressionRange.value = String(studioState.suppression);
  if (featherRange) featherRange.value = String(studioState.feather);
  if (scaleRange) scaleRange.value = String(studioState.scale);
  if (isolationRange) isolationRange.value = String(studioState.isolation);
  if (cropWidthRange) cropWidthRange.value = String(studioState.cropWidth);
  if (cropHeightRange) cropHeightRange.value = String(studioState.cropHeight);
  if (cropDepthRange) cropDepthRange.value = String(studioState.cropDepth || 65);
  if (eraseSizeRange) eraseSizeRange.value = String(studioState.eraseSize);
  if (eraseStrengthRange) eraseStrengthRange.value = String(studioState.eraseStrength);
  maskOvalBtn?.classList.toggle('active', studioState.maskShape !== 'inset');
  maskBoxBtn?.classList.toggle('active', studioState.maskShape === 'inset');
  eraseOvalBtn?.classList.toggle('active', studioState.eraseShape !== 'rect');
  eraseRectBtn?.classList.toggle('active', studioState.eraseShape === 'rect');
  applySceneModeButtons();
  presetButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.preset === name));
  applyStageFilters();
}

async function boot() {
  setLoading('Fetching splat…');
  const sessionRecord = hydrateFromSession();
  currentRecord = (await fetchRecord()) || sessionRecord;
  if (sessionRecord) {
    thumbnailUrl = thumbnailUrl || sessionRecord.thumbnail || '';
    previewVideoUrl = previewVideoUrl || sessionRecord.previewVideo || '';
    fileUrl = fileUrl || _validSplatUrl(sessionRecord.file) || '';
  }

  // Probe fileUrl — if storage returns 400/404 it's a ghost file, use DB record
  // Skip probe for blob: URLs — they don't support HEAD requests
  if (fileUrl && !fileUrl.startsWith('blob:')) {
    try {
      const probe = await fetch(fileUrl, { method: 'HEAD' });
      if (!probe.ok) {
        console.warn('[Viewer] file= URL returned HTTP', probe.status, '— falling back to DB record');
        fileUrl = '';
      }
    } catch(e) {
      console.warn('[Viewer] file= URL unreachable — falling back to DB record');
      fileUrl = '';
    }
  }

  // If fileUrl was bad, wipe sessionStorage so the ghost URL can't come back
  if (!fileUrl) {
    try { sessionStorage.removeItem('fumoca:selectedSplat'); } catch(_) {}
  }

  applyHeader(currentRecord);
  if (!fileUrl && currentRecord) fileUrl = resolveSplatUrl(currentRecord);
  console.log('[Viewer] Final fileUrl:', fileUrl || '(empty — no renderable file found)');
  configurePreview(currentRecord);
  await detectManagePermission();
  window.dispatchEvent(new CustomEvent('fumoca:recordLoaded', { detail: currentRecord || null }));
  loadHotspots();
  renderHotspots();
  loadCutoutMasks();
  renderCutoutMasks();
  loadLassoShapes();
  renderLassoShapes();
  loadSavedLook();
  applyStageFilters();
  setVariantDirty(false);
  const status = normalizeStatus(currentRecord?.status, fileUrl);
  if (!fileUrl) {
    if (status === 'processing' || status === 'queued') {
      showError('This splat is still processing. Open the teaser while the interactive version finishes.');
      if ((previewVideoUrl || thumbnailUrl) && autoplayPreview) openPreview('splat');
    } else if (status === 'failed') {
      showError('Processing failed for this splat.');
    } else {
      showError('No interactive splat file found for this record.');
    }
    return;
  }
  if (!isSplatUrl(fileUrl)) {
    showError(`Unrecognised file type: ${fileUrl.split('?')[0].split('/').pop()}`);
    return;
  }
  if ((previewVideoUrl || thumbnailUrl) && autoplayPreview) openPreview('splat');
  // Route PLY files to THREE.js viewer; .splat/.ksplat to GaussianSplats3D
  // Check type hint from open.html (blob URLs have no extension)
  const _blobType = sessionStorage.getItem('fumoc_pending_splat_type');
  if (_blobType) sessionStorage.removeItem('fumoc_pending_splat_type');

  if (_isNifUrl(fileUrl) || (_blobType === 'nif' && fileUrl.startsWith('blob:'))) {
    // .nif is the native format — decode its KEYFRAME_GEO chunk and hand the
    // gaussian data to the existing GaussianSplats3D renderer for full
    // anisotropic-splat fidelity (no re-wrap into any other container format).
    setLoading('Decoding .nif…');
    try {
      const nifResp   = await fetch(fileUrl);
      const nifBuffer = await nifResp.arrayBuffer();
      if (fileUrl.startsWith('blob:')) URL.revokeObjectURL(fileUrl);

      const { meta, gaussians } = decodeNif(nifBuffer);
      const splatBytes = geometryToSplatRows(gaussians);
      const splatBlob  = new Blob([splatBytes], { type: 'application/octet-stream' });
      fileUrl = URL.createObjectURL(splatBlob);

      // Mirror the same window globals FumocDecoder.loadIntoViewer exposed,
      // so hotspot/tour/title UI code elsewhere in this file keeps working.
      window._fumocaTourStops   = meta.tourStops  || [];
      window._fumocaHotspots    = meta.hotspots   || [];
      window._fumocaOpenedMeta  = meta;

      console.log(`[Viewer] .nif decoded → ${gaussians.count.toLocaleString()} gaussians`);
    } catch (err) {
      showError('Failed to decode .nif file: ' + err.message);
      console.error('[Viewer] nif decode error:', err);
      return;
    }
  } else if (_blobType === 'fumoc' && fileUrl.startsWith('blob:')) {
    // .fumoc is a container — must decode to raw .splat before rendering
    setLoading('Decoding .fumoc…');
    try {
      const fumocResp   = await fetch(fileUrl);
      const fumocBuffer = await fumocResp.arrayBuffer();
      URL.revokeObjectURL(fileUrl); // free the .fumoc blob
      const { splatUrl, decoded } = await FumocDecoder.loadIntoViewer(fumocBuffer);
      fileUrl = splatUrl; // swap to the decoded .splat blob URL
      // Expose tour/hotspot data that loadIntoViewer sets on window
      console.log('[Viewer] .fumoc decoded → splat blob ready');
    } catch (err) {
      showError('Failed to decode .fumoc file: ' + err.message);
      console.error('[Viewer] fumoc decode error:', err);
      return;
    }
  }

  if (_isPlyUrl(fileUrl) && _blobType !== 'splat') {
    await mountPlyViewer(fileUrl);
  } else {
    await mountInteractiveViewer();
  }
}

teaserBtn?.addEventListener('click', () => { _fumocaTrack('preview_open', { mode: 'splat' }); openPreview('splat'); });
closePreviewBtn?.addEventListener('click', closePreview);
viewInteractiveBtn?.addEventListener('click', closePreview);
shareTeaserBtn?.addEventListener('click', () => openPreview('splat'));
splatModeBtn?.addEventListener('click', () => setPreviewMode('splat'));
videoModeBtn?.addEventListener('click', () => setPreviewMode(previewVideoUrl ? 'video' : 'splat'));
copyLinkBtn?.addEventListener('click', async () => {
  _fumocaTrack('share_copy_attempt', { recordId: currentRecord?.id || null });
  const shareUrl = new URL(window.location.href);
  // Always generate a clean public link — strip admin/session params, add ?public=1
  shareUrl.searchParams.delete('embed');
  shareUrl.searchParams.set('public', '1');
  if (currentRecord?.id && !shareUrl.searchParams.get('splatId')) shareUrl.searchParams.set('splatId', currentRecord.id);
  if (thumbnailUrl && !shareUrl.searchParams.get('thumbnail')) shareUrl.searchParams.set('thumbnail', thumbnailUrl);
  if (previewVideoUrl && !shareUrl.searchParams.get('previewVideo')) shareUrl.searchParams.set('previewVideo', previewVideoUrl);
  // Strip any back= param so recipient's back button just closes/goes back normally
  shareUrl.searchParams.delete('back');
  const value = shareUrl.toString();
  let ok = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch (_) {}
  if (!ok) {
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      ok = document.execCommand('copy');
      ta.remove();
    } catch (_) {}
  }
  copyLinkBtn.textContent = ok ? 'Copied' : 'Select URL';
  if (!ok) window.prompt('Copy this link', value);
  setTimeout(() => { copyLinkBtn.textContent = 'Copy link'; }, 1800);
});


compareBtn?.addEventListener('mousedown', () => document.body.classList.add('compare-original'));
compareBtn?.addEventListener('mouseup', () => document.body.classList.remove('compare-original'));
compareBtn?.addEventListener('mouseleave', () => document.body.classList.remove('compare-original'));
compareBtn?.addEventListener('touchstart', () => document.body.classList.add('compare-original'), { passive: true });
compareBtn?.addEventListener('touchend', () => document.body.classList.remove('compare-original'));
modeProductBtn?.addEventListener('click', () => setSceneMode('product'));
modeCarBtn?.addEventListener('click', () => setSceneMode('car'));
modeRealEstateBtn?.addEventListener('click', () => setSceneMode('realestate'));
modePersonBtn?.addEventListener('click', () => setSceneMode('person'));
lassoModeBtn?.addEventListener('click', () => setLassoMode(!lassoMode));
lassoKeepBtn?.addEventListener('click', () => setLassoAction('keep'));
lassoRemoveBtn?.addEventListener('click', () => setLassoAction('remove'));
clearLassoBtn?.addEventListener('click', () => { lassoShapes = []; cancelActiveLasso(); saveLassoShapes(); renderLassoShapes(); updateViewerMask(); setVariantDirty(true); });

const exportFigurineBtn = document.getElementById('exportFigurineBtn');
const exportFigurineStatus = document.getElementById('exportFigurineStatus');
exportFigurineBtn?.addEventListener('click', async () => {
  const { exportSelectionAsFigurine, pollPrintJob } = await import('./print-export.js');
  exportFigurineBtn.disabled = true;
  exportFigurineStatus.style.display = 'block';
  const setStatus = (msg) => { exportFigurineStatus.textContent = msg; };
  try {
    const jobId = await exportSelectionAsFigurine({ onStatus: setStatus });
    setStatus('Queued — waiting for the server to build your figurine…');
    pollPrintJob(jobId, (job) => {
      if (job.status === 'complete') {
        const stlUrl = job.meta?.stl_url;
        exportFigurineStatus.innerHTML = stlUrl
          ? `✅ Ready — <a href="${stlUrl}" target="_blank" style="color:#C8FF00;">Download STL</a>`
          : '✅ Done, but no download link came back — check the job record.';
        exportFigurineBtn.disabled = false;
      } else if (job.status === 'failed') {
        setStatus('❌ ' + (job.error_message || 'Export failed — see server logs.'));
        exportFigurineBtn.disabled = false;
      } else {
        setStatus(`Processing… (${job.progress || 0}%)`);
      }
    });
  } catch (err) {
    setStatus('❌ ' + err.message);
    exportFigurineBtn.disabled = false;
  }
});
eraseModeBtn?.addEventListener('click', () => setEraseMaskMode(!eraseMaskMode));
clearMasksBtn?.addEventListener('click', () => { cutoutMasks = []; saveCutoutMasks(); renderCutoutMasks(); updateViewerMask(); setVariantDirty(true); });
eraseSizeRange?.addEventListener('input', () => { studioState.eraseSize = Number(eraseSizeRange.value); renderStudioLabels(); setVariantDirty(true); });
eraseStrengthRange?.addEventListener('input', () => { studioState.eraseStrength = Number(eraseStrengthRange.value); renderStudioLabels(); renderCutoutMasks(); updateViewerMask(); setVariantDirty(true); });
eraseOvalBtn?.addEventListener('click', () => { studioState.eraseShape = 'ellipse'; eraseOvalBtn.classList.add('active'); eraseRectBtn?.classList.remove('active'); renderStudioLabels(); setVariantDirty(true); });
eraseRectBtn?.addEventListener('click', () => { studioState.eraseShape = 'rect'; eraseRectBtn.classList.add('active'); eraseOvalBtn?.classList.remove('active'); renderStudioLabels(); setVariantDirty(true); });
saveLookBtn?.addEventListener('click', () => { const ok = saveCurrentLook(); setVariantDirty(false); saveLookBtn.textContent = ok ? 'Saved' : 'Save failed'; setTimeout(() => saveLookBtn.textContent = 'Save look', 1600); });
loadLookBtn?.addEventListener('click', () => { const ok = loadSavedLook(); loadLookBtn.textContent = ok ? 'Loaded' : 'No saved look'; setTimeout(() => loadLookBtn.textContent = 'Load saved', 1600); });

function _fumocaClearRendererPreview() {
  if (!rendererPreviewUrl) return;
  try { URL.revokeObjectURL(rendererPreviewUrl); } catch (_) {}
  rendererPreviewUrl = null;
}

async function _fumocaApplyRendererPreview(url) {
  if (!url) return;
  const seq = ++rendererPreviewSeq;
  // This viewer build cannot reliably ingest blob/object URLs as live splat scenes.
  // Keep the original viewer mounted and let the edit overlay remain the active editing surface.
  if (String(url).startsWith('blob:')) {
    rendererPreviewPending = false;
    hint.textContent = 'Edit overlay active. Save variant to apply the cleaned splat.';
    hint.classList.remove('hidden');
    exposeToEditEngine();
    _fumocaExposeViewerBridge();
    return;
  }
  rendererPreviewUrl = url;
  rendererPreviewPending = true;
  await mountInteractiveViewer(true);
  if (seq !== rendererPreviewSeq) return;
  exposeToEditEngine();
  _fumocaExposeViewerBridge();
}

function _fumocaRestoreRendererPreview() {
  rendererPreviewSeq += 1;
  _fumocaClearRendererPreview();
  if (viewerInstance) mountInteractiveViewer(true);
}

function _fumocaLoadPipelineQueue() {
  try { return JSON.parse(localStorage.getItem(pipelineQueueKey) || '[]'); } catch (_) { return []; }
}
function _fumocaSavePipelineQueue(queue) {
  try { localStorage.setItem(pipelineQueueKey, JSON.stringify(queue)); } catch (_) {}
}
function _fumocaEnqueuePipelineRetry(kind, payload = {}) {
  const queue = _fumocaLoadPipelineQueue();
  queue.push({
    id: `pq_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    kind,
    payload,
    attempt: 0,
    nextTryAt: Date.now() + 1500,
    recordId: currentRecord?.id || null,
  });
  _fumocaSavePipelineQueue(queue);
  window.dispatchEvent(new CustomEvent('fumoca:pipelineQueueChanged', { detail: queue }));
  _fumocaSchedulePipelineFlush(1000);
}
async function _fumocaFlushPipelineQueue() {
  clearTimeout(pipelineRetryTimer);
  const queue = _fumocaLoadPipelineQueue();
  if (!queue.length) return;
  const now = Date.now();
  const next = [];
  let nextDelay = null;
  for (const item of queue) {
    if ((item.nextTryAt || 0) > now) {
      next.push(item);
      nextDelay = nextDelay == null ? Math.max(500, item.nextTryAt - now) : Math.min(nextDelay, Math.max(500, item.nextTryAt - now));
      continue;
    }
    try {
      const currentMeta = { ...((currentRecord || {}).metadata || {}) };
      const queue = Array.isArray(currentMeta.processing_requests) ? currentMeta.processing_requests.slice() : [];
      const existing = queue.find((q) => q && q.id === item.payload?.id);
      if (!existing && supabase && currentRecord?.id) {
        queue.unshift(item.payload);
        currentMeta.processing_requests = queue.slice(0, 50);
        currentMeta.last_processing_request = item.payload;
        const { error } = await supabase.from('splats').update({ metadata: currentMeta }).eq('id', currentRecord.id);
        if (error) throw error;
        currentRecord = { ...(currentRecord || {}), metadata: currentMeta };
        window._fumocaCurrentRecord = currentRecord;
      }
      _fumocaShowPipelineIllusion('Finishing background prep…', 1400);
      window.dispatchEvent(new CustomEvent('fumoca:pipelineRetry', { detail: item }));
      item.attempt = (item.attempt || 0) + 1;
      if (item.attempt >= 6) continue;
      item.nextTryAt = now + Math.min(120000, 1500 * Math.pow(2, item.attempt));
      next.push(item);
      nextDelay = nextDelay == null ? item.nextTryAt - now : Math.min(nextDelay, item.nextTryAt - now);
    } catch (_) {
      next.push(item);
    }
  }
  _fumocaSavePipelineQueue(next);
  window.dispatchEvent(new CustomEvent('fumoca:pipelineQueueChanged', { detail: next }));
  if (next.length) _fumocaSchedulePipelineFlush(nextDelay || 3000);
}
function _fumocaSchedulePipelineFlush(delay = 2500) {
  clearTimeout(pipelineRetryTimer);
  pipelineRetryTimer = setTimeout(_fumocaFlushPipelineQueue, Math.max(400, delay));
}

function _fumocaTrack(event, detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent('fumoca:track', { detail: { event, ...detail } }));
  } catch (_) {}
}

// ── STUDIO PANEL CONTROLS ────────────────────────────────────────
// (variant save / queue / range inputs wired once here; a second
//  block further down handles the _fumocaSaveVariant path — kept
//  there so the canManage guard applies correctly)
cleanupRange?.addEventListener('input', () => { studioState.cleanup = Number(cleanupRange.value); renderStudioLabels(); setVariantDirty(true); });
sharpnessRange?.addEventListener('input', () => { studioState.sharpness = Number(sharpnessRange.value); applyStageFilters(); setVariantDirty(true); });
presenceRange?.addEventListener('input', () => { studioState.presence = Number(presenceRange.value); applyStageFilters(); setVariantDirty(true); });
focusRange?.addEventListener('input', () => { studioState.focus = Number(focusRange.value); applyStageFilters(); setVariantDirty(true); });
focusXRange?.addEventListener('input', () => { studioState.focusX = Number(focusXRange.value); applyStageFilters(); setVariantDirty(true); });
focusYRange?.addEventListener('input', () => { studioState.focusY = Number(focusYRange.value); applyStageFilters(); setVariantDirty(true); });
suppressionRange?.addEventListener('input', () => { studioState.suppression = Number(suppressionRange.value); applyStageFilters(); setVariantDirty(true); });
featherRange?.addEventListener('input', () => { studioState.feather = Number(featherRange.value); applyStageFilters(); setVariantDirty(true); });
scaleRange?.addEventListener('input', () => { studioState.scale = Number(scaleRange.value); applyStageFilters(); setVariantDirty(true); });
isolationRange?.addEventListener('input', () => { studioState.isolation = Number(isolationRange.value); applyStageFilters(); setVariantDirty(true); });
cropWidthRange?.addEventListener('input', () => { studioState.cropWidth = Number(cropWidthRange.value); applyStageFilters(); setVariantDirty(true); });
cropHeightRange?.addEventListener('input', () => { studioState.cropHeight = Number(cropHeightRange.value); applyStageFilters(); setVariantDirty(true); });
cropDepthRange?.addEventListener('input', () => { studioState.cropDepth = Number(cropDepthRange.value); renderStudioLabels(); setVariantDirty(true); });
maskOvalBtn?.addEventListener('click', () => { studioState.maskShape = 'ellipse'; maskOvalBtn.classList.add('active'); maskBoxBtn?.classList.remove('active'); applyStageFilters(); setVariantDirty(true); });
maskBoxBtn?.addEventListener('click', () => { studioState.maskShape = 'inset'; maskBoxBtn.classList.add('active'); maskOvalBtn?.classList.remove('active'); applyStageFilters(); setVariantDirty(true); });
applyStudioBtn?.addEventListener('click', () => mountInteractiveViewer(true));

// ── GPU Image Quality sliders — realtime, no geometry rebuild ─────────────────
const Q_PRESETS = {
  balanced:  { brightness:1.00, contrast:1.08, saturation:1.12, sharpness:0.72, bloom:0.55 },
  postshot:  { brightness:1.05, contrast:1.18, saturation:1.28, sharpness:0.88, bloom:0.80 },
  cinematic: { brightness:0.92, contrast:1.32, saturation:0.95, sharpness:0.60, bloom:1.20 },
  raw:       { brightness:1.00, contrast:1.00, saturation:1.00, sharpness:0.50, bloom:0.00 },
};

function _applyQuality(opts) {
  window.FumocaGaussianRenderer?.setQuality(opts);
  // Update slider UI to match
  if (opts.brightness  != null) { const el=document.getElementById('qBrightnessRange');  if(el){el.value=opts.brightness;  const _bv=document.getElementById('qBrightnessValue'); if(_bv) _bv.textContent=opts.brightness.toFixed(2);} }
  if (opts.contrast    != null) { const el=document.getElementById('qContrastRange');    if(el){el.value=opts.contrast;    const _cv=document.getElementById('qContrastValue'); if(_cv) _cv.textContent=opts.contrast.toFixed(2);} }
  if (opts.saturation  != null) { const el=document.getElementById('qSaturationRange'); if(el){el.value=opts.saturation;  const _sv=document.getElementById('qSaturationValue'); if(_sv) _sv.textContent=opts.saturation.toFixed(2);} }
  if (opts.sharpness   != null) { const el=document.getElementById('qSharpnessRange');  if(el){el.value=opts.sharpness;   const _shv=document.getElementById('qSharpnessValue'); if(_shv) _shv.textContent=opts.sharpness.toFixed(2);} }
  if (opts.bloom       != null) { const el=document.getElementById('qBloomRange');      if(el){el.value=opts.bloom;       const _blv=document.getElementById('qBloomValue'); if(_blv) _blv.textContent=opts.bloom.toFixed(2);} }
}

document.getElementById('qBrightnessRange') ?.addEventListener('input', e => { document.getElementById('qBrightnessValue') .textContent=parseFloat(e.target.value).toFixed(2); window.FumocaGaussianRenderer?.setQuality({brightness:parseFloat(e.target.value)}); });
document.getElementById('qContrastRange')   ?.addEventListener('input', e => { document.getElementById('qContrastValue')   .textContent=parseFloat(e.target.value).toFixed(2); window.FumocaGaussianRenderer?.setQuality({contrast:parseFloat(e.target.value)}); });
document.getElementById('qSaturationRange') ?.addEventListener('input', e => { document.getElementById('qSaturationValue') .textContent=parseFloat(e.target.value).toFixed(2); window.FumocaGaussianRenderer?.setQuality({saturation:parseFloat(e.target.value)}); });
document.getElementById('qSharpnessRange')  ?.addEventListener('input', e => { document.getElementById('qSharpnessValue')  .textContent=parseFloat(e.target.value).toFixed(2); window.FumocaGaussianRenderer?.setQuality({sharpness:parseFloat(e.target.value)}); });
document.getElementById('qBloomRange')      ?.addEventListener('input', e => { document.getElementById('qBloomValue')      .textContent=parseFloat(e.target.value).toFixed(2); window.FumocaGaussianRenderer?.setQuality({bloom:parseFloat(e.target.value)}); });

// Quality preset buttons
document.querySelectorAll('[data-qpreset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = Q_PRESETS[btn.dataset.qpreset];
    if (!preset) return;
    _applyQuality(preset);
    document.getElementById('qPresetValue').textContent = btn.textContent;
    document.querySelectorAll('[data-qpreset]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// Apply balanced preset on load
window.addEventListener('fumoca:recordLoaded', () => {
  setTimeout(() => _applyQuality(Q_PRESETS.balanced), 400);
});
resetStudioBtn?.addEventListener('click', async () => {
  Object.assign(studioState, defaultStudio);
  cutoutMasks = [];
  lassoShapes = [];
  activeLassoPoints = [];
  saveCutoutMasks();
  saveLassoShapes();
  renderCutoutMasks();
  renderLassoShapes();
  activatePreset('balanced');
  setVariantDirty(false);
  await mountInteractiveViewer(true);
});
presetButtons.forEach(btn => btn.addEventListener('click', () => activatePreset(btn.dataset.preset || 'balanced')));

previewOverlay?.addEventListener('click', (e) => { if (e.target === previewOverlay) closePreview(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePreview(); cancelActiveLasso(); setLassoMode(false); } });

rebuildStageHost();

const cfg = window.FUMOCA_CONFIG || {};
if (!cfg.supabaseUrl || cfg.supabaseUrl.includes('YOUR_PROJECT')) {
  showError('Supabase is not configured. Set window.FUMOCA_CONFIG in config.js.');
} else {
  activatePreset('balanced');
  boot();
}

window.addEventListener('resize', applyStageFilters);
window.addEventListener('fumoca:tourStarted', () => _fumocaTrack('tour_started', { recordId: currentRecord?.id || null }));
window.addEventListener('fumoca:tourStopped', () => _fumocaTrack('tour_stopped', { recordId: currentRecord?.id || null }));
window.addEventListener('fumoca:hotspotOpened', (e) => _fumocaTrack('hotspot_opened', { id: e.detail?.id || null, type: e.detail?.type || null }));
window.addEventListener('fumoca:variantSaved', (e) => _fumocaTrack('variant_saved', { savedRemote: !!e.detail?.savedRemote }));
window.addEventListener('fumoca:pipelineQueued', (e) => _fumocaTrack('pipeline_queued', { kind: e.detail?.kind || null }));
window.addEventListener('fumoca:pipelineRetry', (e) => _fumocaTrack('pipeline_retry', { kind: e.detail?.kind || null, attempt: e.detail?.attempt || 0 }));
window.addEventListener('online', () => _fumocaSchedulePipelineFlush(800));
window.addEventListener('fumoca:editPreviewReady', () => { /* disabled: blob preview remounts ruin edit feel in current renderer */ });
window.addEventListener('fumoca:editMaskUpdated', () => { /* disabled: keep edit overlay stable while cleaning */ });
window.addEventListener('fumoca:editPreviewCleared', () => { /* disabled while overlay-based editing is active */ });
if (!window._fumocaUseHotspotPro) hotspotBtn?.addEventListener('click', () => setHotspotMode(!hotspotEditMode));
focusFrame?.addEventListener('pointerdown', (e) => {
  if (!hotspotEditMode) return;
  const handle = e.target?.dataset?.handle || 'move';
  cropDragState = { handle };
  focusFrame.setPointerCapture?.(e.pointerId);
  e.preventDefault();
});
document.addEventListener('pointermove', (e) => {
  if (!cropDragState) return;
  syncCropFromPointer(e.clientX, e.clientY, cropDragState.handle);
});
document.addEventListener('pointerup', () => { cropDragState = null; });
lassoSvg?.addEventListener('pointerdown', (e) => {
  if (!lassoMode) return;
  activeLassoPoints = [];
  pushLassoPointFromEvent(e);
  lassoSvg.setPointerCapture?.(e.pointerId);
  e.preventDefault();
});
lassoSvg?.addEventListener('pointermove', (e) => {
  if (!lassoMode || !activeLassoPoints.length) return;
  pushLassoPointFromEvent(e);
  e.preventDefault();
});
lassoSvg?.addEventListener('pointerup', (e) => {
  if (!lassoMode) return;
  pushLassoPointFromEvent(e);
  completeActiveLasso();
  e.preventDefault();
});

hotspotLayer?.addEventListener('click', (e) => {
  if (window._fumocaUseHotspotPro || !hotspotEditMode || e.target !== hotspotLayer) return;
  const rect = hotspotLayer.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  const title = window.prompt('Hotspot label', 'Inspect');
  if (title === null) return;
  const link = window.prompt('Optional hotspot link', '');
  hotspots.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), title: title.trim() || 'Inspect', link: (link || '').trim() });
  saveHotspots();
  renderHotspots();
});
maskLayer?.addEventListener('click', (e) => {
  if (!eraseMaskMode || e.target !== maskLayer) return;
  const rect = maskLayer.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  const size = Number(studioState.eraseSize || 18);
  cutoutMasks.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)), w: Number(size.toFixed(2)), h: Number((size * (studioState.eraseShape === 'rect' ? 0.9 : 1.1)).toFixed(2)), shape: studioState.eraseShape, strength: Number(studioState.eraseStrength || 92) });
  saveCutoutMasks();
  renderCutoutMasks();
  updateViewerMask();
  setVariantDirty(true);
});

deleteUploadBtn?.addEventListener('click', () => { _fumocaTrack('delete_upload_click', { recordId: currentRecord?.id || null }); return deleteCurrentUpload(); });

// ── EXPOSE STATE TO EDIT ENGINE ──────────────────────────────────
// edit-engine.js reads these window properties to access the live
// splat URL, Supabase client, and current record without coupling.
function exposeToEditEngine() {
  window._fumocaSplatUrl = getActiveSplatUrl() || '';
  window._fumocaSupabase = supabase;
  window._fumocaCurrentRecord = currentRecord;
}
// Update whenever fileUrl or currentRecord change (boot sets both)
const _origBoot = typeof boot === 'function' ? boot : null;
// Patch: after boot resolves, expose state
const _bootInterval = setInterval(() => {
  if (fileUrl) {
    exposeToEditEngine();
    clearInterval(_bootInterval);
  }
}, 500);
window.addEventListener('fumoca:recordLoaded', exposeToEditEngine);
// Also expose immediately in case already set
exposeToEditEngine();


// ── V29 bridge patch: expose session, viewer, camera, controls for admin-only tools ──
async function _fumocaExposeSession() {
  try {
    if (!window._fumocaSupabase?.auth?.getSession) return;
    const { data } = await window._fumocaSupabase.auth.getSession();
    if (data?.session) {
      window._fumocaSession = data.session;
      window.dispatchEvent(new CustomEvent('fumoca:sessionReady', { detail: data.session }));
    }
  } catch (_) {}
}

function _fumocaPick(obj, keys) {
  for (const key of keys) {
    try {
      const value = key.split('.').reduce((acc, part) => acc?.[part], obj);
      if (value) return value;
    } catch (_) {}
  }
  return null;
}

function _fumocaExposeViewerBridge() {
  try {
    window._fumocaViewerInstance = viewerInstance || null;
    const cam = _fumocaPick(viewerInstance, [
      'camera',
      'viewerCamera',
      'perspectiveCamera',
      'threeCamera',
      'cameraController.camera',
      'sceneHelper.camera',
    ]);
    const controls = _fumocaPick(viewerInstance, [
      'controls',
      'orbitControls',
      'cameraControls',
      'cameraController.controls',
    ]);
    if (cam) window._fumocaViewerCamera = cam;
    if (controls) window._fumocaViewerControls = controls;
    window._fumocaViewer = {
      viewer: viewerInstance || null,
      camera: window._fumocaViewerCamera || null,
      controls: window._fumocaViewerControls || null,
      stage: stageHost || stageEl || null,
      fileUrl: fileUrl || '',
      record: currentRecord || null,
    };
    const ready = !!(viewerInstance && (window._fumocaViewerCamera || window._fumocaViewerControls));
    if (ready) {
      window.dispatchEvent(new CustomEvent('fumoca:viewerReady', {
        detail: {
          viewer: viewerInstance,
          camera: window._fumocaViewerCamera || null,
          controls: window._fumocaViewerControls || null,
        }
      }));
    }
  } catch (_) {}
}

_fumocaExposeSession();
try {
  if (window._fumocaSupabase?.auth?.onAuthStateChange) {
    window._fumocaSupabase.auth.onAuthStateChange((_event, session) => {
      window._fumocaSession = session || null;
      window.dispatchEvent(new CustomEvent('fumoca:sessionReady', { detail: session || null }));
    });
  }
} catch (_) {}

const _fumocaBridgeInterval = setInterval(() => {
  _fumocaExposeViewerBridge();
  if (viewerInstance && (window._fumocaViewerCamera || window._fumocaViewerControls)) {
    clearInterval(_fumocaBridgeInterval);
  }
}, 700);
window.addEventListener('fumoca:recordLoaded', () => {
  _fumocaExposeSession();
  _fumocaExposeViewerBridge();
});


// ── V31 FULL-FORCE PLATFORM PATCH ───────────────────────────────
window._fumocaPermissions = {
  isOwner: false,
  isAdmin: false,
  canEdit: false,
  canDelete: false,
  canManage: false,
  role: null,
  userId: null,
  ownerId: null,
};

function _fumocaSyncPermissions() {
  const role = String(manageAccess.role || '').toLowerCase();
  const isAdmin = ['admin', 'super_admin', 'owner'].includes(role);
  const isOwner = !!(manageAccess.userId && manageAccess.ownerId && manageAccess.userId === manageAccess.ownerId);
  window._fumocaPermissions = {
    isOwner,
    isAdmin,
    canEdit: !!manageAccess.canManage,
    canDelete: !!manageAccess.canManage,
    canManage: !!manageAccess.canManage,
    role: manageAccess.role || null,
    userId: manageAccess.userId || null,
    ownerId: manageAccess.ownerId || null,
  };
  window.dispatchEvent(new CustomEvent('fumoca:permissionsUpdated', { detail: window._fumocaPermissions }));
  window.dispatchEvent(new CustomEvent('fumoca:permissionsReady', { detail: window._fumocaPermissions }));
}

const _origDetectManagePermission = detectManagePermission;
detectManagePermission = async function patchedDetectManagePermission() {
  const out = await _origDetectManagePermission.apply(this, arguments);
  _fumocaSyncPermissions();
  return out;
};

function _fumocaCreateEmbedUrl() {
  const u = new URL(window.location.href);
  u.searchParams.set('embed', '1');
  if (currentRecord?.id && !u.searchParams.get('splatId')) u.searchParams.set('splatId', currentRecord.id);
  if (fileUrl && !u.searchParams.get('file')) u.searchParams.set('file', fileUrl);
  if (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) && !u.searchParams.get('quality')) {
    u.searchParams.set('quality', 'mobile');
  }
  return u.toString();
}

function _fumocaGetSceneMode() {
  return studioState.sceneMode || 'product';
}

function _fumocaBuildRecipe(name = 'Working Variant') {
  return {
    id: (window.crypto?.randomUUID?.() || `variant_${Date.now()}`),
    name,
    created_at: new Date().toISOString(),
    scene_mode: _fumocaGetSceneMode(),
    studio: { ...studioState },
    hotspots: Array.isArray(window._fumocaHotspots) ? window._fumocaHotspots : undefined,
    source_splat_url: fileUrl || '',
    record_id: currentRecord?.id || null,
  };
}

async function _fumocaSaveVariant(name = null) {
  const variantName = (name || window.prompt('Variant name', 'Clean Variant') || '').trim();
  if (!variantName) return null;
  const rec = currentRecord || {};
  const metadata = { ...(rec.metadata || {}) };
  const variants = Array.isArray(metadata.variants) ? metadata.variants.slice() : [];
  const recipe = _fumocaBuildRecipe(variantName);
  variants.unshift(recipe);
  metadata.variants = variants.slice(0, 25);
  let savedRemote = false;
  if (supabase && rec.id) {
    try {
      const { error } = await supabase.from('splats').update({ metadata }).eq('id', rec.id);
      if (error) throw error;
      savedRemote = true;
    } catch (err) {
      console.warn('[fumoca] variant remote save failed', err);
    }
  }
  currentRecord = { ...rec, metadata };
  window._fumocaCurrentRecord = currentRecord;
  try {
    localStorage.setItem(`fumoca_variants_${rec.id || location.pathname}`, JSON.stringify(metadata.variants));
  } catch (_) {}
  window.dispatchEvent(new CustomEvent('fumoca:variantsUpdated', { detail: metadata.variants }));
  window.dispatchEvent(new CustomEvent('fumoca:variantSaved', { detail: { savedRemote, recipe } }));
  return { savedRemote, recipe };
}

function _fumocaLoadVariants() {
  const rec = currentRecord || {};
  const metadata = rec.metadata || {};
  let variants = Array.isArray(metadata.variants) ? metadata.variants.slice() : [];
  if (!variants.length) {
    try {
      const raw = localStorage.getItem(`fumoca_variants_${rec.id || location.pathname}`);
      if (raw) variants = JSON.parse(raw);
    } catch (_) {}
  }
  return Array.isArray(variants) ? variants : [];
}

function _fumocaApplyRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return false;
  const incoming = recipe.studio || {};
  Object.assign(studioState, { ...defaultStudio, ...incoming });
  try { applyStudioLook(); } catch (_) {}
  try { updateStudioUi(); } catch (_) {}
  window.dispatchEvent(new CustomEvent('fumoca:recipeApplied', { detail: recipe }));
  return true;
}

async function _fumocaQueuePipeline(kind = 'mesh_cleanup', extraPayload = {}) {
  const rec = currentRecord || {};
  const safeExtra = (extraPayload && typeof extraPayload === 'object' && !Array.isArray(extraPayload)) ? extraPayload : {};
  const payload = {
    ...safeExtra,
    id: safeExtra.id || window.crypto?.randomUUID?.() || `${kind}_${Date.now()}`,
    kind,
    created_at: safeExtra.created_at || new Date().toISOString(),
    scene_mode: safeExtra.scene_mode || _fumocaGetSceneMode(),
    source_splat_id: safeExtra.source_splat_id || rec.id || null,
    source_splat_url: safeExtra.source_splat_url || fileUrl || rec.splat_url || '',
    source_record_id: safeExtra.source_record_id || rec.id || null,
    status: safeExtra.status || 'queued',
  };
  const metadata = { ...(rec.metadata || {}) };
  const queue = Array.isArray(metadata.processing_requests) ? metadata.processing_requests.slice() : [];
  queue.unshift(payload);
  metadata.processing_requests = queue.slice(0, 50);
  metadata.last_processing_request = payload;
  let savedRemote = false;
  if (supabase && rec.id) {
    try {
      const { error } = await supabase.from('splats').update({ metadata }).eq('id', rec.id);
      if (error) throw error;
      savedRemote = true;
    } catch (err) {
      console.warn('[fumoca] queue pipeline remote save failed', err);
      try {
        _fumocaEnqueuePipelineRetry(kind, payload);
      } catch (_) {}
    }
  } else {
    try {
      _fumocaEnqueuePipelineRetry(kind, payload);
    } catch (_) {}
  }
  currentRecord = { ...rec, metadata };
  window._fumocaCurrentRecord = currentRecord;
  const label = String(kind || 'pipeline').replace(/_/g, ' ');
  _fumocaShowPipelineIllusion(savedRemote ? `${label} queued` : `${label} saved locally — syncing soon`, 1800);
  window.dispatchEvent(new CustomEvent('fumoca:pipelineQueued', { detail: { ...payload, savedRemote } }));
  return { ...payload, savedRemote };
}

function _fumocaApplyAutoCleanPreset(mode = 'product') {
  const presets = {
    car: { cleanup: 9, sharpness: 34, presence: 108, suppression: 26, focus: 38, cropDepth: 72 },
    real_estate: { cleanup: 7, sharpness: 24, presence: 102, suppression: 18, focus: 48, cropDepth: 82 },
    person: { cleanup: 10, sharpness: 30, presence: 110, suppression: 28, focus: 32, cropDepth: 68 },
    product: { cleanup: 6, sharpness: 28, presence: 106, suppression: 22, focus: 40, cropDepth: 70 },
  };
  Object.assign(studioState, presets[mode] || presets.product, { sceneMode: mode });
  try { applyStudioLook(); } catch (_) {}
  try { updateStudioUi(); } catch (_) {}
  window.dispatchEvent(new CustomEvent('fumoca:autoCleanApplied', { detail: { mode, studio: { ...studioState } } }));
}

function _fumocaExposePlatform() {
  window._fumocaCreateEmbedUrl = _fumocaCreateEmbedUrl;
  window._fumocaSaveVariant = _fumocaSaveVariant;
  window._fumocaLoadVariants = _fumocaLoadVariants;
  window._fumocaApplyRecipe = _fumocaApplyRecipe;
  window._fumocaQueuePipeline = _fumocaQueuePipeline;
  window._fumocaApplyAutoCleanPreset = _fumocaApplyAutoCleanPreset;
  window._fumocaApi = {
    upload: '/api/splats/upload',
    getSplat: '/api/splats/:id',
    updateSplat: '/api/splats/:id',
    deleteSplat: '/api/splats/:id',
    hotspots: '/api/splats/:id/hotspots',
    variants: '/api/splats/:id/variants',
    tours: '/api/splats/:id/tours',
    jobs: '/api/jobs/:id',
  };
  window._fumocaPerformance = window._fumocaPerformance || {
    progressiveLoading: true,
    lodSuggested: false,
    pointBudget: 500000,
    mobileReducedFx: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent),
  };
  window._fumocaViewer = {
    viewer: viewerInstance || null,
    camera: window._fumocaViewerCamera || null,
    controls: window._fumocaViewerControls || null,
    stage: stageHost || stageEl || null,
    fileUrl: fileUrl || '',
    record: currentRecord || null,
  };
}

saveVariantBtn?.addEventListener('click', async () => {
  if (!window._fumocaPermissions?.canManage) return;
  await _fumocaSaveVariant();
});
saveVariantPanelBtn?.addEventListener('click', async () => {
  if (!window._fumocaPermissions?.canManage) return;
  await _fumocaSaveVariant();
});
downloadRecipeBtn?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(_fumocaBuildRecipe('Recipe Export'), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `fumoca_recipe_${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
});
queueMeshCleanupBtn?.addEventListener('click', async () => {
  await _fumocaQueuePipeline('mesh_cleanup');
  alert('Mesh cleanup queued.');
});
queuePrintCleanupBtn?.addEventListener('click', async () => {
  await _fumocaQueuePipeline('print_prep');
  alert('Print prep queued.');
});
saveLookBtn?.addEventListener('click', () => {
  try {
    localStorage.setItem('fumoca_saved_look', JSON.stringify({ ...studioState }));
    alert('Look saved.');
  } catch (_) {}
});
loadLookBtn?.addEventListener('click', () => {
  try {
    const raw = localStorage.getItem('fumoca_saved_look');
    if (!raw) return;
    Object.assign(studioState, JSON.parse(raw) || {});
    applyStudioLook();
    updateStudioUi();
  } catch (_) {}
});
copyLinkBtn?.addEventListener('contextmenu', async (e) => {
  e.preventDefault();
  try {
    await navigator.clipboard.writeText(`<iframe src="${_fumocaCreateEmbedUrl()}" style="width:100%;height:100%;border:0;" allowfullscreen></iframe>`);
    hint.textContent = 'Embed code copied';
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 1400);
  } catch (_) {}
});
modeCarBtn?.addEventListener('click', () => _fumocaApplyAutoCleanPreset('car'));
modeRealEstateBtn?.addEventListener('click', () => _fumocaApplyAutoCleanPreset('real_estate'));
modePersonBtn?.addEventListener('click', () => _fumocaApplyAutoCleanPreset('person'));
modeProductBtn?.addEventListener('click', () => _fumocaApplyAutoCleanPreset('product'));
window.addEventListener('fumoca:viewerReady', _fumocaExposePlatform);
window.addEventListener('fumoca:recordLoaded', _fumocaExposePlatform);
_fumocaExposePlatform();
_fumocaSyncPermissions();
_fumocaSchedulePipelineFlush(1200);
window.dispatchEvent(new CustomEvent('fumoca:requestEditPreview'));

// ── SPLAT CAPTURE BRIDGE ─────────────────────────────────────────
// Exposes the renderer canvas so SplatCapture can record the live viewer.
function _fumocaExposeCaptureBridge() {
  try {
    const vi = viewerInstance;
    if (!vi) return;
    // Try multiple paths to find the renderer canvas
    const canvas =
      vi?.renderer?.domElement ||
      vi?.threeRenderer?.domElement ||
      vi?.sceneHelper?.renderer?.domElement ||
      document.getElementById('stageHost')?.querySelector('canvas') ||
      document.getElementById('stage')?.querySelector('canvas');
    if (canvas instanceof HTMLCanvasElement) {
      window._fumocaCaptureCanvas = canvas;
    }
  } catch (_) {}
}

// Expose on viewer ready and on load
window.addEventListener('fumoca:viewerReady', _fumocaExposeCaptureBridge);
// Also poll briefly after mount to catch delayed canvas creation
const _captureBridgeInterval = setInterval(() => {
  _fumocaExposeCaptureBridge();
  if (window._fumocaCaptureCanvas) clearInterval(_captureBridgeInterval);
}, 500);
setTimeout(() => clearInterval(_captureBridgeInterval), 12000);


// ── AUTO PREVIEW GENERATION ─────────────────────────────────────
function _fumocaSupportsAutoCapture() {
  try {
    return !!(window.SplatCapture && window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
  } catch (_) {
    return false;
  }
}

function _fumocaPreviewStorageKey() {
  return `fumoca_preview_autocap_${currentRecord?.id || fileUrl || location.pathname}`;
}

function _fumocaShouldAutoCapture() {
  const q = new URLSearchParams(location.search);
  if (q.get('autocap') === '0') return false;
  if (!_fumocaSupportsAutoCapture()) return false;
  if (!window._fumocaPermissions?.canManage) return false;
  if (previewVideoUrl) return false;
  if (!fileUrl) return false;
  try {
    if (sessionStorage.getItem(_fumocaPreviewStorageKey()) === 'done' && q.get('autocap') !== '1') return false;
  } catch (_) {}
  return true;
}

function _fumocaMarkAutoCapture(state = 'done') {
  try { sessionStorage.setItem(_fumocaPreviewStorageKey(), state); } catch (_) {}
}

function _fumocaRunTeaserMotion() {
  try {
    const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    const engine = window._fumocaCameraEngine;
    const target = controls?.target;
    pulseStageFeedback('capture');
    if (engine?.focusCurrentTarget && target) {
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.008, duration: 540, verticalLift: 0.02, overshoot: 0.01 }), 40);
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.034, duration: 860, verticalLift: 0.028, overshoot: 0.012 }), 430);
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.07, duration: 1120, verticalLift: 0.036, overshoot: 0.014 }), 1180);
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.116, duration: 1380, verticalLift: 0.048, overshoot: 0.016 }), 2180);
      setTimeout(() => engine.focusCurrentTarget({ zoom: 1.142, duration: 1320, verticalLift: 0.052, overshoot: 0.018 }), 3560);
      return true;
    }
  } catch (_) {}
  return false;
}

async function _fumocaAutoGeneratePreviewVideo() {
  if (!_fumocaShouldAutoCapture()) return false;
  _fumocaMarkAutoCapture('running');
  const statusBefore = hint?.textContent || '';
  if (hint) {
    hint.textContent = 'Generating teaser preview…';
    hint.classList.remove('hidden');
  }
  try {
    _fumocaRunTeaserMotion();
    await window.SplatCapture.start({
      fps: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 24 : 30,
      duration: 6400,
      videoBitrate: /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 2500000 : 4200000,
    });
    const publicUrl = await window.SplatCapture.uploadToSupabase('preview-videos', currentRecord?.id || null);
    if (publicUrl) {
      previewVideoUrl = publicUrl;
      if (currentRecord) {
        currentRecord.preview_video_url = publicUrl;
        window._fumocaCurrentRecord = currentRecord;
      }
      configurePreview(currentRecord || null);
      window.dispatchEvent(new CustomEvent('fumoca:previewVideoReady', {
        detail: { url: publicUrl, recordId: currentRecord?.id || null, auto: true }
      }));
      _fumocaMarkAutoCapture('done');
      if (hint) {
        pulseStageFeedback('capture');
        hint.textContent = 'Teaser preview generated';
        setTimeout(() => { hint.textContent = statusBefore; hint.classList.add('hidden'); }, 1800);
      }
      return true;
    }
  } catch (err) {
    console.warn('[fumoca] auto preview generation failed', err);
  }
  _fumocaMarkAutoCapture('failed');
  if (hint) {
    hint.textContent = statusBefore;
    setTimeout(() => hint.classList.add('hidden'), 900);
  }
  return false;
}

window.addEventListener('fumoca:viewerReady', () => {
  setTimeout(() => { _fumocaAutoGeneratePreviewVideo(); }, 1400);
});
window.addEventListener('fumoca:permissionsUpdated', () => {
  setTimeout(() => { _fumocaAutoGeneratePreviewVideo(); }, 400);
});
window.addEventListener('fumoca:captureUploaded', (e) => {
  const url = e?.detail?.publicUrl;
  if (!url) return;
  previewVideoUrl = url;
  if (currentRecord) {
    currentRecord.preview_video_url = url;
    window._fumocaCurrentRecord = currentRecord;
  }
  configurePreview(currentRecord || null);
});
