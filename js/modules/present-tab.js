/**
 * FUMOCA Present Tab — all Present tools live in the Present sidebar section
 * Magazine text · Nav · Review video · Save / share (keeps text for viewer)
 */
import {
  initMagazineText, addText, updateText, removeText, applyPreset, clearText,
  exportAll as exportMagazine, importAll as importMagazine, setEditable as setMagEditable,
} from './present-magazine-text.js?v=20261106-editorialstudio02';
import {
  initPresentNav, setNavStops, addNavStop, removeNavStop, clearNavStops, flyToStop,
  stopsFromHotspots, exportStops, importStops,
} from './present-nav.js';
import './poster-composer.js?v=20261106-assets01';
import './poster-assets.js?v=20261106-layercontrols01';
import { mountPosterEditorOverlay as createPosterEditorOverlay } from './poster-editor-overlay.js?v=20261106-headlinepreview01';

const STORAGE_KEY = 'fumoca_present_v1';

async function compressEditorialImage(file, maxEdge = 1600) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error('Choose a PNG, JPG, WEBP or GIF image.');
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  let quality = 0.82;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let dataUrl = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (dataUrl.length <= 170000) break;
    scale *= 0.84;
    quality = Math.max(0.48, quality - 0.06);
  }
  bitmap.close?.();
  if (dataUrl.length > 180000) throw new Error('Image is too detailed to embed safely. Please choose a smaller image.');
  return dataUrl;
}

function idKey() {
  const q = new URLSearchParams(location.search);
  return (
    q.get('nifId') || q.get('splatId') || q.get('id') ||
    window._fumocaCurrentSplatId ||
    window._fumocaCurrentRecord?.id ||
    'default'
  );
}

function loadLocal() {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[idKey()] || all.default || null;
  } catch { return null; }
}

function saveLocal(data) {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const id = idKey();
    all[id] = data;
    all.default = data;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (_) {}
}

function payload() {
  return {
    magazine: exportMagazine(),
    nav: exportStops(),
    reviewLayout: window.FumocaReviewVideo?.getLayout?.() || null,
    reviewUrl: (window.FumocaReviewVideo?.getSrc?.() && !String(window.FumocaReviewVideo.getSrc()).startsWith('blob:'))
      ? window.FumocaReviewVideo.getSrc()
      : null,
    poster: window.FumocaPoster?.getState?.() || null,
    updatedAt: Date.now(),
  };
}

function persist() {
  const data = payload();
  saveLocal(data);
  window.__FUMOCA_PRESENT__ = data;
  try {
    const rec = window._fumocaCurrentRecord;
    if (rec) {
      rec.meta = rec.meta || {};
      rec.metadata = rec.metadata || {};
      rec.meta.present = data;
      rec.metadata.present = data;
      if (data.reviewUrl) {
        rec.meta.reviewVideo = { url: data.reviewUrl };
        rec.metadata.reviewVideo = { url: data.reviewUrl };
      }
    }
  } catch (_) {}
  return data;
}

async function savePosterToCloud() {
  const status = document.getElementById('ptpPosterCloudStatus');
  const setStatus = (message, failed = false) => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = failed ? 'error' : 'ok';
  };
  const record = window._fumocaCurrentRecord;
  const supabase = window._fumocaSupabase || window.supabase;
  if (!record?.id) {
    setStatus('Open a saved NIF asset before saving a poster to the cloud.', true);
    return false;
  }
  if (!supabase?.auth?.getUser || !supabase?.from) {
    setStatus('Account connection is not ready. Your local composition is still saved.', true);
    return false;
  }
  setStatus('Saving poster to this asset…');
  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData?.user) throw new Error('Sign in before saving this poster to the cloud.');
    const data = payload();
    const metadata = { ...(record.meta || {}), present: data };
    const { error } = await supabase.from('nif_files').update({ meta: metadata }).eq('id', record.id);
    if (error) throw error;
    record.meta = metadata;
    record.metadata = { ...(record.metadata || {}), present: data };
    window._fumocaCurrentRecord = record;
    setStatus('Saved to this NIF asset · available to its public viewer.');
    return true;
  } catch (error) {
    console.warn('[Poster Composer] Cloud save failed', error);
    setStatus(error?.message || 'Cloud save failed. Your local composition is still saved.', true);
    return false;
  }
}

async function copyViewerLink() {
  const data = persist();
  const media = data.poster?.composition;
  const hasLocalMedia = /^data:image\//i.test(media?.background?.value || '') ||
    (media?.assets?.images || []).some(item => /^data:image\//i.test(item.src || ''));
  if (hasLocalMedia) {
    const saved = await savePosterToCloud();
    if (!saved) {
      alert('This composition contains uploaded images. Save it to a saved NIF asset first; then copy a clean viewer link.');
      return;
    }
  }
  let json;
  try {
    json = hasLocalMedia ? '' : btoa(unescape(encodeURIComponent(JSON.stringify({
      magazine: data.magazine,
      nav: data.nav,
      reviewUrl: data.reviewUrl,
      reviewLayout: data.reviewLayout || 'stack',
      poster: data.poster || null,
    }))));
  } catch { json = ''; }
  const id = idKey();
  let base = window._fumocaShareUrl || `${location.origin}/viewer?nifId=${encodeURIComponent(id === 'default' ? '' : id)}`;
  const url = new URL(base, location.origin);
  if (hasLocalMedia) url.searchParams.delete('present');
  if (json) url.searchParams.set('present', json);
  if (data.reviewUrl) url.searchParams.set('review', data.reviewUrl);
  if (data.reviewLayout) url.searchParams.set('rvLayout', data.reviewLayout);
  const str = url.toString();
  navigator.clipboard?.writeText(str).then(
    () => alert('Viewer link copied.\nIncludes magazine text' + (data.reviewUrl ? ' + review video URL' : ' (local video stays on this device only)') + '.'),
    () => prompt('Copy link:', str)
  );
}

function findPresentHost() {
  // Always live inside the Present tab body. Never float on the canvas.
  const tab = document.getElementById('tab-present');
  if (tab) return tab;
  return document.getElementById('panelLeft') || document.body;
}

function syncPresentActive() {
  const tab = document.getElementById('tab-present');
  const open = tab && tab.style.display !== 'none';
  document.body.classList.toggle('present-active', !!open);
}

function renderNavManager() {
  const root = document.getElementById('ptpNavManager');
  if (!root) return;
  const stops = exportStops();
  root.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'ptp-hint';
  heading.textContent = stops.length ? ('Navigation stops: ' + stops.length + ' · remove any stop below') : 'No navigation stops yet.';
  root.appendChild(heading);
  stops.forEach((stop, index) => {
    const row = document.createElement('div'); row.className = 'ptp-nav-item';
    const label = document.createElement('span'); label.textContent = (index + 1) + '. ' + (stop.label || 'View'); label.title = stop.id;
    const remove = document.createElement('button'); remove.type = 'button'; remove.dataset.removeNav = stop.id; remove.textContent = 'Remove';
    row.append(label, remove); root.appendChild(row);
  });
}

function renderTextManager() {
  const root = document.getElementById('ptpTextManager');
  if (!root) return;
  const items = exportMagazine();
  root.replaceChildren();
  if (!items.length) {
    const hint = document.createElement('div');
    hint.className = 'ptp-hint';
    hint.textContent = 'Add a preset or + Custom text to edit its wording, font, size and color here.';
    root.appendChild(hint);
    return;
  }
  const styles = [
    ['cover', 'Cover'], ['masthead', 'Masthead'], ['deck', 'Clean sans'],
    ['kicker', 'Mono / Kicker'], ['badge', 'Badge'], ['caption', 'Caption'],
  ];
  const fonts = [
    ['"Bebas Neue", Impact, sans-serif', 'Bebas Neue'],
    ['"Cormorant Garamond", Georgia, serif', 'Cormorant Garamond'],
    ['"Playfair Display", Georgia, serif', 'Playfair Display'],
    ['"DM Sans", system-ui, sans-serif', 'DM Sans'],
    ['"Space Grotesk", system-ui, sans-serif', 'Space Grotesk'],
    ['Inter, system-ui, sans-serif', 'Inter'],
    ['Arial, Helvetica, sans-serif', 'Arial'],
    ['Georgia, serif', 'Georgia'],
    ['"Times New Roman", serif', 'Times New Roman'],
    ['"IBM Plex Mono", monospace', 'IBM Plex Mono'],
    ['"Trebuchet MS", sans-serif', 'Trebuchet MS'],
  ];
  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'ptp-text-item';
    const heading = document.createElement('div');
    heading.className = 'ptp-text-heading';
    heading.textContent = (index + 1) + '. ' + (item.text || 'Text');
    const fields = document.createElement('div');
    fields.className = 'ptp-text-fields';
    fields.innerHTML = `
      <label>Text<input data-text-id="${item.id}" data-text-field="text" value="${escapeAttr(item.text || '')}" /></label>
      <label>Style<select data-text-id="${item.id}" data-text-field="style">${styles.map(([v, label]) => `<option value="${v}" ${(item.style || 'cover') === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label>Font family<select data-text-id="${item.id}" data-text-field="fontFamily">${fonts.map(([v, label]) => `<option value="${escapeAttr(v)}" ${(item.fontFamily || '') === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label>Size (px)<input type="number" min="8" max="240" step="1" data-text-id="${item.id}" data-text-field="fontSize" value="${Number(item.fontSize || (item.style === 'cover' ? 64 : item.style === 'masthead' ? 36 : 14))}" /></label>
      <label>Color<input type="color" data-text-id="${item.id}" data-text-field="color" value="${/^#[0-9a-f]{6}$/i.test(item.color || '') ? item.color : '#F2EFE6'}" /></label>
      <label>Align<select data-text-id="${item.id}" data-text-field="align"><option value="left" ${(item.align || 'left') === 'left' ? 'selected' : ''}>Left</option><option value="center" ${item.align === 'center' ? 'selected' : ''}>Center</option><option value="right" ${item.align === 'right' ? 'selected' : ''}>Right</option></select></label>
      <label>Position X<input type="number" min="0" max="100" step="1" data-text-id="${item.id}" data-text-field="sx" value="${Math.round(item.sx ?? 50)}" /></label>
      <label>Position Y<input type="number" min="0" max="100" step="1" data-text-id="${item.id}" data-text-field="sy" value="${Math.round(item.sy ?? 30)}" /></label>
      <label>Weight<select data-text-id="${item.id}" data-text-field="weight">${[300,400,500,600,700,800,900].map(v => `<option value="${v}" ${Number(item.weight || (item.style === 'cover' ? 800 : 600)) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Tracking (em)<input type="number" min="-0.08" max="0.4" step="0.01" data-text-id="${item.id}" data-text-field="tracking" value="${Number(item.tracking ?? 0.02)}" /></label>
      <label>Opacity %<input type="number" min="0" max="100" step="5" data-text-id="${item.id}" data-text-field="opacity" value="${Math.round((item.opacity ?? 1) * 100)}" /></label>
      <label>Max width %<input type="number" min="10" max="100" step="1" data-text-id="${item.id}" data-text-field="maxWidth" value="${parseFloat(item.maxWidth) || (item.style === 'deck' ? 38 : 42)}" /></label>
      <label class="ptp-text-check"><input type="checkbox" data-text-id="${item.id}" data-text-field="wrap" ${item.wrap ? 'checked' : ''}> Wrap lines</label>
      <label class="ptp-text-check"><input type="checkbox" data-text-id="${item.id}" data-text-field="uppercase" ${item.uppercase !== false ? 'checked' : ''}> Uppercase</label>
      <button type="button" data-remove-text="${item.id}" class="ptp-danger">Delete text</button>
    `;
    card.append(heading, fields);
    root.appendChild(card);
  });
}
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let posterEditorOverlay = null;

function mountStudioPosterOverlay() {
  if (posterEditorOverlay) { posterEditorOverlay.refresh(); return; }
  posterEditorOverlay = createPosterEditorOverlay({
    onCommit: () => persist(),
  });
}

function mountPanel() {
  let panel = document.getElementById('fumocaPresentTabPanel');
  if (panel) { mountStudioPosterOverlay(); return panel; }

  panel = document.createElement('div');
  panel.id = 'fumocaPresentTabPanel';
  panel.innerHTML = `
    <div class="ptp-section" id="ptpPosterComposer">
      <div class="ptp-title">Poster Composer · fixed canvas</div>
      <div class="ptp-hint">The poster keeps its chosen aspect ratio while the 3D subject can be repositioned, scaled and rotated. Live transforms work in published Spark PLY, legacy PLY and decoded NIF cloud viewers.</div>
      <label class="ptp-poster-field">Preset<select data-poster-field="preset"><option value="product">Product · 4:5</option><option value="story">Story · 9:16</option><option value="editorial">Editorial · 3:4</option><option value="landscape">Landscape · 16:9</option></select></label>
      <label class="ptp-poster-toggle"><input type="checkbox" data-poster-field="enabled"> Enable poster composition</label>
      <label class="ptp-poster-field">Headline<input type="text" maxlength="160" data-poster-field="title" placeholder="Product title"></label>
      <label class="ptp-poster-toggle"><input type="checkbox" data-poster-field="titleVisible" checked> Show headline</label>
      <div class="ptp-poster-grid">
        <label class="ptp-poster-field">Headline alignment<select data-poster-field="titleAlign"><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
        <label class="ptp-poster-field">Headline font<select data-poster-field="titleFont"><option value="system-ui, sans-serif">Modern Sans</option><option value="Arial, sans-serif">Arial</option><option value="Georgia, serif">Editorial Serif</option><option value="Impact, sans-serif">Impact</option><option value="monospace">Mono</option></select></label>
        <label class="ptp-poster-field">Headline size<input type="range" min="12" max="120" value="42" data-poster-field="titleSize"><output data-poster-value="titleSize">42 px</output></label>
        <label class="ptp-poster-field">Headline colour<input type="color" value="#ffffff" data-poster-field="titleColor"></label>
      </div>
      <div class="ptp-poster-subtitle">BACKGROUND & ART DIRECTION</div>
      <label class="ptp-poster-field">Background colour<input type="color" data-poster-field="background" value="#10131a"></label>
      <label class="ptp-poster-field">Background image<input type="file" accept="image/png,image/jpeg,image/webp" data-poster-field="backgroundFile"></label>
      <label class="ptp-poster-field">Or background image URL<input type="url" placeholder="https://…" data-poster-field="backgroundUrl"></label>
      <div class="ptp-poster-grid">
        <label class="ptp-poster-field">Image fit<select data-poster-field="backgroundFit"><option value="cover">Fill canvas</option><option value="contain">Contain</option><option value="fill">Stretch</option></select></label>
        <label class="ptp-poster-field">Image position<select data-poster-field="backgroundPosition"><option value="center">Center</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="left">Left</option><option value="right">Right</option></select></label>
        <label class="ptp-poster-field">Background opacity<input type="range" min="0" max="100" value="100" data-poster-field="backgroundOpacity"></label>
        <label class="ptp-poster-field">Background blur<input type="range" min="0" max="30" value="0" data-poster-field="backgroundBlur"></label>
        <label class="ptp-poster-field">Brightness<input type="range" min="20" max="200" value="100" data-poster-field="backgroundBrightness"></label>
      </div>
      <div class="ptp-poster-subtitle">SUPPORTING IMAGES</div>
      <label class="ptp-poster-field">Add image / logo / texture<input type="file" accept="image/png,image/jpeg,image/webp" data-poster-field="overlayFile" multiple></label>
      <div class="ptp-poster-actions"><button type="button" data-act="add-overlay-url">Add image from URL</button><button type="button" data-act="clear-overlays">Remove all images</button></div>
      <div id="ptpPosterAssetList" class="ptp-poster-status">No supporting images added yet.</div>
      <div class="ptp-poster-hint">Select, drag and resize image layers on the poster. Set proportional, fixed-pixel or responsive min/max sizing, lock layers, hide them and change their stacking order. These are presentation layers and do not alter the source splat.</div>
      <div class="ptp-poster-grid">
        <label class="ptp-poster-field">Subject X <input type="range" min="0" max="100" value="50" data-poster-field="x"><output data-poster-value="x">50%</output></label>
        <label class="ptp-poster-field">Subject Y <input type="range" min="0" max="100" value="53" data-poster-field="y"><output data-poster-value="y">53%</output></label>
        <label class="ptp-poster-field">Subject scale <input type="range" min="10" max="400" value="100" data-poster-field="scale"><output data-poster-value="scale">1.00×</output></label>
        <label class="ptp-poster-field">Subject rotation <input type="range" min="-180" max="180" value="0" data-poster-field="rotation"><output data-poster-value="rotation">0°</output></label>
      </div>
      <div class="ptp-poster-status" id="ptpPosterStatus">Studio now provides a drag handle over the real 3D viewport. Drag the ring or focus it and use arrow keys; the poster frame shows the selected composition bounds.</div>
      <div class="ptp-poster-actions"><button type="button" data-act="poster-cloud-save" class="primary">Save poster to asset</button><button type="button" data-act="copy" class="ptp-poster-copy">Copy viewer link</button></div>
      <div class="ptp-poster-status" id="ptpPosterCloudStatus">Local composition is saved automatically. Cloud save is a separate action.</div>
    </div>
    <div class="ptp-section">
      <div class="ptp-title">Magazine cover text</div>
      <div class="ptp-row">
        <button type="button" data-act="weekly">WEEKLY</button>
        <button type="button" data-act="48hours">48 HOURS</button>
        <button type="button" data-act="product">Product</button>
        <button type="button" data-act="hero">Hero title</button>
        <button type="button" data-act="luxury">Luxury</button>
        <button type="button" data-act="fashion">Fashion</button>
        <button type="button" data-act="launch">Product launch</button>
        <button type="button" data-act="architecture">Architecture</button>
        <button type="button" data-act="clear-text">Clear text</button>
        <button type="button" data-act="add-custom-text" class="primary">+ Custom text</button>
      </div>
      <div class="ptp-hint">Choose a complete editorial direction, then refine every text layer. Drag text on the canvas or set exact position, typography, width and opacity below.</div>
    </div>
    <div class="ptp-section">
      <div class="ptp-title">Text styling · edit each item</div>
      <div id="ptpTextManager" class="ptp-text-manager"></div>
    </div>
    <div class="ptp-section">
      <div class="ptp-title">Nav · Matterport style</div>
      <div class="ptp-row">
        <button type="button" data-act="add-nav">+ Nav stop</button>
        <button type="button" data-act="from-hs">From hotspots</button>
        <button type="button" data-act="clear-nav">Clear all stops</button>
        <button type="button" data-act="save" class="primary">Save</button>
        <button type="button" data-act="copy" class="primary">Copy viewer link</button>
      </div>
    </div>
    <div class="ptp-section">
      <div id="ptpNavManager" class="ptp-nav-manager"></div>
    </div>
    <div class="ptp-section">
      <div class="ptp-title">Review video</div>
      <div class="ptp-row">
        <button type="button" data-act="pick" class="primary">Upload from device</button>
        <button type="button" data-act="url">Paste URL</button>
        <button type="button" data-act="clear-vid">Clear</button>
      </div>
      <div class="ptp-row" style="margin-top:8px">
        <button type="button" data-layout="pip">PIP</button>
        <button type="button" data-layout="stack">Stack 50/50</button>
        <button type="button" data-layout="split">Split 50/50</button>
        <button type="button" data-layout="full">Full video</button>
        <button type="button" data-layout="cinema">Cinema</button>
        <button type="button" data-layout="bg">BG</button>
        <button type="button" data-layout="hidden">Off</button>
      </div>
      <div class="ptp-status" id="ptpVidStatus">Split and Stack share the workspace. Play sits on the video.</div>
    </div>
  `;

  if (!document.getElementById('fumocaPosterComposerStyles')) {
    const style = document.createElement('style');
    style.id = 'fumocaPosterComposerStyles';
    style.textContent = `
      #ptpPosterComposer .ptp-poster-field{display:flex;flex-direction:column;gap:5px;margin:9px 0;color:rgba(255,255,255,.72);font-size:11px}
      #ptpPosterComposer .ptp-poster-field input:not([type=range]),#ptpPosterComposer .ptp-poster-field select{width:100%;min-width:0;padding:8px 9px;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(255,255,255,.05);color:#fff;font:inherit}
      #ptpPosterComposer .ptp-poster-field input[type=color]{height:34px;padding:3px}
      #ptpPosterComposer .ptp-poster-toggle{display:flex;align-items:center;gap:8px;margin:10px 0;color:rgba(255,255,255,.8);font-size:11px}
      #ptpPosterComposer .ptp-poster-toggle input{accent-color:#c8ff00}
      #ptpPosterComposer .ptp-poster-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px}
      #ptpPosterComposer .ptp-poster-field output{color:#c8ff00;font:10px monospace}
      #ptpPosterComposer .ptp-poster-status{padding:8px 10px;border:1px solid rgba(200,255,0,.16);border-radius:8px;background:rgba(200,255,0,.045);color:rgba(255,255,255,.55);font-size:10px;line-height:1.45}
      #ptpPosterComposer .ptp-poster-subtitle{margin:14px 0 7px;color:#c8ff00;font:700 10px/1.3 monospace;letter-spacing:.1em}
      #ptpPosterComposer .ptp-poster-hint{font-size:10px;line-height:1.45;color:rgba(255,255,255,.55);margin-top:7px}
      #ptpPosterComposer input[type=file]{font-size:10px;padding:7px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#ddd;width:100%}
      #ptpPosterAssetList button{margin:5px 5px 0 0;padding:5px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:#20242b;color:#fff;font-size:10px;cursor:pointer}
      #ptpPosterComposer .ptp-poster-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      #ptpPosterComposer .ptp-poster-actions button{border:1px solid rgba(200,255,0,.28);border-radius:8px;padding:8px 10px;background:rgba(200,255,0,.09);color:#eaffb0;font:inherit;font-size:10px;cursor:pointer}
      #ptpPosterComposer .ptp-poster-actions button.primary{background:#c8ff00;color:#10131a;font-weight:700}
      #ptpPosterComposer #ptpPosterCloudStatus[data-state="error"]{border-color:rgba(255,90,90,.35);color:#ffb1b1}
      #ptpPosterComposer .ptp-title{color:#c8ff00}
      #fumocaPresentTabPanel .ptp-text-fields .ptp-text-check{display:flex;flex-direction:row;align-items:center;gap:6px;min-height:30px}
      #fumocaPresentTabPanel .ptp-text-fields .ptp-text-check input{accent-color:#c8ff00}
      #fumocaPresentTabPanel .ptp-text-fields .ptp-danger{grid-column:1/-1}
      @media(max-width:520px){#ptpPosterComposer .ptp-poster-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  const host = findPresentHost();
  host.appendChild(panel);
  syncPresentActive();
  mountStudioPosterOverlay();

  const posterRoot = panel.querySelector('#ptpPosterComposer');
  const syncPosterControls = () => {
    const state = window.FumocaPoster?.getState?.();
    if (!state || !posterRoot) return;
    const c = state.composition;
    posterRoot.querySelector('[data-poster-field="preset"]').value = state.preset;
    posterRoot.querySelector('[data-poster-field="enabled"]').checked = state.enabled;
    posterRoot.querySelector('[data-poster-field="title"]').value = c.title?.text || '';
    posterRoot.querySelector('[data-poster-field="titleVisible"]').checked = c.title?.visible !== false;
    posterRoot.querySelector('[data-poster-field="titleAlign"]').value = c.title?.align || 'center';
    posterRoot.querySelector('[data-poster-field="titleFont"]').value = c.title?.fontFamily || 'system-ui, sans-serif';
    posterRoot.querySelector('[data-poster-field="titleSize"]').value = String(c.title?.fontSize || 42);
    posterRoot.querySelector('[data-poster-field="titleColor"]').value = /^#[0-9a-f]{6}$/i.test(c.title?.color || '') ? c.title.color : '#ffffff';
    const titleSizeOutput = posterRoot.querySelector('[data-poster-value="titleSize"]');
    if (titleSizeOutput) titleSizeOutput.textContent = (c.title?.fontSize || 42) + ' px';
    posterRoot.querySelector('[data-poster-field="background"]').value = /^#[0-9a-f]{6}$/i.test(c.background?.value || '') ? c.background.value : '#10131a';
    for (const [key, value] of Object.entries({
      backgroundFit: c.background?.fit || 'cover',
      backgroundPosition: c.background?.position || 'center',
      backgroundOpacity: Math.round((c.background?.opacity ?? 1) * 100),
      backgroundBlur: c.background?.blur || 0,
      backgroundBrightness: Math.round((c.background?.brightness ?? 1) * 100),
    })) {
      const input = posterRoot.querySelector(`[data-poster-field="${key}"]`);
      if (input) input.value = String(value);
    }
    renderPosterAssetList();
    for (const key of ['x','y','scale','rotation']) {
      const value = c.object?.[key] ?? 0;
      const input = posterRoot.querySelector(`[data-poster-field="${key}"]`);
      const output = posterRoot.querySelector(`[data-poster-value="${key}"]`);
      if (input) input.value = String(key === 'x' || key === 'y' ? Math.round(value * 100) : key === 'scale' ? Math.round(value * 100) : Math.round(value));
      if (output) output.textContent = key === 'scale' ? `${Number(value).toFixed(2)}×` : key === 'rotation' ? `${Math.round(value)}°` : `${Math.round(value * 100)}%`;
    }
  };
  let selectedPosterAssetId = null;
  const renderPosterAssetList = () => {
    const root = posterRoot.querySelector('#ptpPosterAssetList');
    if (!root) return;
    const images = window.FumocaPoster?.getState?.()?.composition?.assets?.images || [];
    root.replaceChildren();
    if (!images.length) { root.textContent = 'No supporting images added yet.'; return; }
    images.slice().sort((a,b) => (b.z || 0) - (a.z || 0)).forEach((item) => {
      const row = document.createElement('div');
      row.className = 'ptp-poster-layer-row';
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin:5px 0;padding:6px;border:1px solid rgba(255,255,255,.1);border-radius:7px';
      const select = document.createElement('button');
      select.type = 'button'; select.textContent = item.name || 'Image layer';
      select.dataset.posterAssetAction = 'select'; select.dataset.posterAssetId = item.id;
      select.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left';
      const visible = document.createElement('button');
      visible.type = 'button'; visible.textContent = item.visible === false ? 'Show' : 'Hide';
      visible.dataset.posterAssetAction = 'visibility'; visible.dataset.posterAssetId = item.id;
      const lock = document.createElement('button');
      lock.type = 'button'; lock.textContent = item.locked ? 'Unlock' : 'Lock';
      lock.dataset.posterAssetAction = 'lock'; lock.dataset.posterAssetId = item.id;
      const up = document.createElement('button');
      up.type = 'button'; up.textContent = '↑'; up.title = 'Bring forward';
      up.dataset.posterAssetAction = 'up'; up.dataset.posterAssetId = item.id;
      const down = document.createElement('button');
      down.type = 'button'; down.textContent = '↓'; down.title = 'Send backward';
      down.dataset.posterAssetAction = 'down'; down.dataset.posterAssetId = item.id;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×'; remove.title = 'Remove image';
      remove.dataset.posterAssetAction = 'remove'; remove.dataset.posterAssetId = item.id;
      row.append(select, visible, lock, up, down, remove);
      root.appendChild(row);
    });
    const selected = images.find(item => item.id === selectedPosterAssetId);
    if (!selected) return;
    const editor = document.createElement('div');
    editor.className = 'ptp-poster-layer-editor';
    editor.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px;padding:9px;border:1px solid rgba(200,255,0,.25);border-radius:8px';
    const field = (label, key, value, type = 'number', attrs = '') => {
      const wrap = document.createElement('label');
      wrap.className = 'ptp-poster-field';
      wrap.textContent = label;
      const input = document.createElement('input');
      input.type = type; input.dataset.posterAssetField = key; input.dataset.posterAssetId = selected.id;
      input.value = String(value ?? '');
      if (attrs) input.setAttribute('aria-label', label);
      if (type === 'number') { input.min = key === 'opacity' ? '0' : '1'; input.max = key === 'opacity' ? '100' : key === 'rotation' ? '180' : '4000'; input.step = '1'; }
      wrap.appendChild(input); editor.appendChild(wrap);
    };
    const selectField = (label, key, value, options) => {
      const wrap = document.createElement('label'); wrap.className = 'ptp-poster-field'; wrap.textContent = label;
      const input = document.createElement('select'); input.dataset.posterAssetField = key; input.dataset.posterAssetId = selected.id;
      options.forEach(([v,t]) => { const option = document.createElement('option'); option.value = v; option.textContent = t; input.appendChild(option); });
      input.value = value; wrap.appendChild(input); editor.appendChild(wrap);
    };
    selectField('Size behaviour','sizeMode',selected.sizeMode || 'proportional',[
      ['proportional','Proportional'],['fixed','Fixed pixels'],['responsive','Responsive min/max'],
    ]);
    field('Width %','width',Math.round((selected.width || .22)*100));
    field('Fixed width px','fixedWidthPx',selected.fixedWidthPx || 240);
    field('Minimum px','minWidthPx',selected.minWidthPx || 72);
    field('Maximum px','maxWidthPx',selected.maxWidthPx || 720);
    field('Rotation °','rotation',selected.rotation || 0);
    field('Opacity %','opacity',Math.round((selected.opacity ?? 1)*100));
    selectField('Anchor','anchor',selected.anchor || 'free',[
      ['free','Free'],['top-left','Top left'],['top','Top'],['top-right','Top right'],
      ['left','Left'],['center','Center'],['right','Right'],
      ['bottom-left','Bottom left'],['bottom','Bottom'],['bottom-right','Bottom right'],
    ]);
    root.appendChild(editor);
  };
  const applyPosterField = async (e) => {
    const field = e.target.closest?.('[data-poster-field]');
    if (!field || !posterRoot?.contains(field) || !window.FumocaPoster) return;
    const key = field.dataset.posterField;
    if (e.type === 'input' && ['backgroundUrl','backgroundFile','overlayFile'].includes(key)) return;
    if (key === 'preset') window.FumocaPoster.setPreset(field.value);
    else if (key === 'enabled') window.FumocaPoster.setEnabled(field.checked);
    else if (key === 'title') window.FumocaPoster.updateComposition({ title: { text: field.value } });
    else if (key === 'titleVisible') window.FumocaPoster.updateComposition({ title: { visible: field.checked } });
    else if (key === 'titleAlign') window.FumocaPoster.updateComposition({ title: { align: field.value } });
    else if (key === 'titleFont') window.FumocaPoster.updateComposition({ title: { fontFamily: field.value } });
    else if (key === 'titleSize') window.FumocaPoster.updateComposition({ title: { fontSize: Number(field.value) } });
    else if (key === 'titleColor') window.FumocaPoster.updateComposition({ title: { color: field.value } });
    else if (key === 'background') window.FumocaPoster.updateComposition({ background: { ...window.FumocaPoster.getState().composition.background, type: 'solid', value: field.value } });
    else if (key === 'backgroundFit') window.FumocaPoster.updateComposition({ background: { fit: field.value } });
    else if (key === 'backgroundPosition') window.FumocaPoster.updateComposition({ background: { position: field.value } });
    else if (key === 'backgroundOpacity') window.FumocaPoster.updateComposition({ background: { opacity: Number(field.value) / 100 } });
    else if (key === 'backgroundBlur') window.FumocaPoster.updateComposition({ background: { blur: Number(field.value) } });
    else if (key === 'backgroundBrightness') window.FumocaPoster.updateComposition({ background: { brightness: Number(field.value) / 100 } });
    else if (key === 'backgroundUrl') {
      if (!/^https?:\/\//i.test(field.value)) { alert('Enter a valid HTTP or HTTPS image URL.'); return; }
      window.FumocaPoster.updateComposition({ background: { type: 'image', value: field.value } });
      field.value = '';
    }
    else if (key === 'backgroundFile' && field.files?.[0]) {
      try {
        const src = await compressEditorialImage(field.files[0], 2200);
        window.FumocaPoster.updateComposition({ background: { type: 'image', value: src, fit: 'cover' } });
      } catch (error) { alert(error.message || 'Could not load that background image.'); }
      field.value = '';
    }
    else if (key === 'overlayFile' && field.files?.length) {
      try {
        const existing = window.FumocaPoster.getState().composition.assets?.images || [];
        const incoming = await Promise.all(Array.from(field.files).slice(0, 12 - existing.length).map(async (file) => ({
          id: 'img_' + Math.random().toString(36).slice(2, 10),
          name: file.name || 'Supporting image',
          src: await compressEditorialImage(file, 1400),
          x: 0.5, y: 0.5, width: 0.22, sizeMode: 'proportional',
          fixedWidthPx: 240, minWidthPx: 72, maxWidthPx: 720, anchor: 'free', locked: false,
          rotation: 0, opacity: 1, z: existing.length + 1,
          fit: 'contain', visible: true,
        })));
        window.FumocaPoster.updateComposition({ assets: { images: [...existing, ...incoming] } });
      } catch (error) { alert(error.message || 'Could not load supporting image.'); }
      field.value = '';
    }
    else if (['x','y','scale','rotation'].includes(key)) {
      const raw = Number(field.value);
      const value = key === 'x' || key === 'y' || key === 'scale' ? raw / 100 : raw;
      window.FumocaPoster.updateComposition({ object: { [key]: value } });
    } else return;
    syncPosterControls();
    persist();
  };
  posterRoot.addEventListener('input', applyPosterField);
  posterRoot.addEventListener('change', applyPosterField);
  posterRoot.addEventListener('input', (event) => {
    const field = event.target.closest('[data-poster-asset-field]');
    if (!field) return;
    const id = field.dataset.posterAssetId, key = field.dataset.posterAssetField;
    const images = window.FumocaPoster.getState().composition.assets?.images || [];
    const item = images.find(entry => entry.id === id);
    if (!item) return;
    let value = field.value;
    if (key === 'sizeMode' || key === 'anchor') item[key] = value;
    else if (key === 'opacity') item.opacity = Math.max(0, Math.min(1, Number(value) / 100));
    else if (key === 'width') item.width = Math.max(.05, Math.min(1, Number(value) / 100));
    else if (['fixedWidthPx','minWidthPx','maxWidthPx','rotation'].includes(key)) item[key] = Number(value);
    window.FumocaPoster.updateComposition({ assets: { images } });
    persist();
  });
  posterRoot.addEventListener('change', (event) => {
    const field = event.target.closest('[data-poster-asset-field]');
    if (field) renderPosterAssetList();
  });
  posterRoot.addEventListener('click', (event) => {
    const action = event.target.closest('[data-poster-asset-action]');
    if (!action) return;
    const id = action.dataset.posterAssetId;
    const images = window.FumocaPoster.getState().composition.assets?.images || [];
    const index = images.findIndex(item => item.id === id);
    if (index < 0) return;
    if (action.dataset.posterAssetAction === 'select') {
      selectedPosterAssetId = id;
      window.FumocaPosterAssets?.select?.(id);
      renderPosterAssetList(); return;
    }
    if (action.dataset.posterAssetAction === 'remove') {
      images.splice(index, 1);
      if (selectedPosterAssetId === id) selectedPosterAssetId = null;
    } else if (action.dataset.posterAssetAction === 'visibility') images[index].visible = images[index].visible === false;
    else if (action.dataset.posterAssetAction === 'lock') images[index].locked = !images[index].locked;
    else if (action.dataset.posterAssetAction === 'up' && index < images.length - 1) [images[index], images[index + 1]] = [images[index + 1], images[index]];
    else if (action.dataset.posterAssetAction === 'down' && index > 0) [images[index], images[index - 1]] = [images[index - 1], images[index]];
    images.forEach((item, i) => { item.z = i + 1; });
    window.FumocaPoster.updateComposition({ assets: { images } });
    persist(); renderPosterAssetList();
  });
  window.addEventListener('fumoca:posterAssetSelected', (event) => {
    selectedPosterAssetId = event.detail?.id || null;
    renderPosterAssetList();
  });
  window.addEventListener('fumoca:posterChange', syncPosterControls);
  syncPosterControls();

  const applyTextField = (e) => {
    const field = e.target.closest?.('[data-text-id][data-text-field]');
    if (!field || !panel.contains(field)) return;
    const key = field.dataset.textField;
    const patch = {};
    if (key === 'fontSize') patch.fontSize = Math.max(8, Math.min(240, Number(field.value) || 14));
    else if (key === 'text') patch.text = field.value;
    else if (key === 'style') patch.style = field.value;
    else if (key === 'fontFamily') patch.fontFamily = field.value;
    else if (key === 'color') patch.color = field.value;
    else if (key === 'align') patch.align = field.value;
    else if (key === 'sx' || key === 'sy') patch[key] = Math.max(0, Math.min(100, Number(field.value) || 0));
    else if (key === 'weight') patch.weight = Math.max(100, Math.min(900, Number(field.value) || 600));
    else if (key === 'tracking') patch.tracking = Math.max(-0.08, Math.min(0.4, Number(field.value) || 0));
    else if (key === 'opacity') patch.opacity = Math.max(0, Math.min(1, Number(field.value) / 100));
    else if (key === 'maxWidth') patch.maxWidth = Math.max(10, Math.min(100, Number(field.value) || 42)) + '%';
    else if (key === 'wrap' || key === 'uppercase') patch[key] = field.checked;
    else return;
    updateText(field.dataset.textId, patch);
    const heading = field.closest('.ptp-text-item')?.querySelector('.ptp-text-heading');
    if (heading && key === 'text') heading.textContent = field.value || 'Text';
    persist();
  };
  // Browsers fire input inconsistently for select/color controls; support both.
  panel.addEventListener('input', applyTextField);
  panel.addEventListener('change', applyTextField);

  panel.addEventListener('click', (e) => {
    const removeTextBtn = e.target.closest('button[data-remove-text]');
    if (removeTextBtn) { removeText(removeTextBtn.dataset.removeText); renderTextManager(); persist(); return; }
    const removeNavBtn = e.target.closest('button[data-remove-nav]');
    if (removeNavBtn) { removeNavStop(removeNavBtn.dataset.removeNav); renderNavManager(); persist(); return; }
    const layoutBtn = e.target.closest('[data-layout]');
    if (layoutBtn) {
      if (!window.FumocaReviewVideo?.setLayout) {
        alert('Review video is not ready. Hard-refresh the editor, then try again.');
        return;
      }
      if (!window.FumocaReviewVideo.getSrc?.()) {
        alert('Upload a video first. Then Stack, Split, PIP and the rest will place it beside the splat.');
      }
      window.FumocaReviewVideo.setLayout(layoutBtn.dataset.layout);
      panel.querySelectorAll('[data-layout]').forEach((b) =>
        b.classList.toggle('active', b === layoutBtn)
      );
      persist();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'add-overlay-url') {
      const url = prompt('Direct image URL (HTTPS recommended)', 'https://');
      if (url && /^https?:\/\//i.test(url)) {
        const images = window.FumocaPoster.getState().composition.assets?.images || [];
        if (images.length >= 12) { alert('A poster can contain up to 12 supporting images.'); return; }
        images.push({ id: 'img_' + Math.random().toString(36).slice(2, 10), name: 'Linked image', src: url, x: 0.5, y: 0.5, width: 0.22, sizeMode: 'proportional', fixedWidthPx: 240, minWidthPx: 72, maxWidthPx: 720, anchor: 'free', locked: false, rotation: 0, opacity: 1, z: images.length + 1, fit: 'contain', visible: true });
        window.FumocaPoster.updateComposition({ assets: { images } }); persist(); renderPosterAssetList();
      }
      return;
    }
    if (act === 'clear-overlays') {
      window.FumocaPoster.updateComposition({ assets: { images: [] } }); persist(); renderPosterAssetList(); return;
    }
    if (act === 'weekly') applyPreset('weekly');
    if (act === '48hours') applyPreset('48hours');
    if (act === 'product') applyPreset('product');
    if (act === 'hero') applyPreset('hero');
    if (act === 'luxury') applyPreset('luxury');
    if (act === 'fashion') applyPreset('fashion');
    if (act === 'launch') applyPreset('launch');
    if (act === 'architecture') applyPreset('architecture');
    if (['weekly','48hours','product','hero','luxury','fashion','launch','architecture'].includes(act)) renderTextManager();
    if (act === 'poster-cloud-save') { savePosterToCloud(); return; }
    if (act === 'clear-text') { clearText(); renderTextManager(); }
    if (act === 'add-custom-text') {
      const value = prompt('Text to display in the scene', 'Your text');
      if (value && value.trim()) { addText({ text: value.trim(), style: 'deck', mode: 'locked', sx: 50, sy: 30, fontSize: 24, align: 'center', wrap: true }); renderTextManager(); }
    }
    if (act === 'clear-nav') {
      if (confirm('Remove all navigation stops for this asset?')) clearNavStops();
      renderNavManager();
    }
    if (act === 'add-nav') {
      const hs = window._fumocaHotspots?.slice?.(-1)?.[0];
      if (hs && Number.isFinite(hs.wx)) {
        addNavStop({ label: hs.title || 'View', wx: hs.wx, wy: hs.wy, wz: hs.wz, zoom: 1.4 });
      } else addNavStop({ label: 'View', sx: 50, sy: 50, zoom: 1.25 });
    }
    if (act === 'from-hs') setNavStops(stopsFromHotspots(window._fumocaHotspots || []));
    renderNavManager();
    if (act === 'save') {
      persist();
      alert('Present saved for this asset (text + nav). Use Copy viewer link to keep text on the public page.');
    }
    if (act === 'copy') copyViewerLink();
    if (act === 'pick') {
      if (!window.FumocaReviewVideo?.pickFromDevice) {
        alert('Review video is not ready. Hard-refresh the editor, then try again.');
        return;
      }
      window.FumocaReviewVideo.pickFromDevice({ layout: 'stack' });
    }
    if (act === 'url') {
      const u = prompt('Direct MP4 URL', 'https://');
      if (u?.startsWith('http')) window.FumocaReviewVideo?.set?.(u, { layout: 'stack' });
    }
    if (act === 'clear-vid') {
      window.FumocaReviewVideo?.set?.(null);
      const st = document.getElementById('ptpVidStatus');
      if (st) st.textContent = 'Video cleared';
    }
    persist();
  });

  window.addEventListener('fumoca:reviewVideoLocal', (ev) => {
    const st = document.getElementById('ptpVidStatus');
    if (st && ev.detail?.name) {
      st.textContent = ev.detail.name + ' · session preview. Paste CDN URL + Copy viewer link to share.';
    }
  });

  return panel;
}

export function initPresentTab() {
  // CSS
  if (!document.querySelector('link[href*="present-unified.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = 'css/present-unified.css';
    document.head.appendChild(l);
  }

  initMagazineText({ editable: true, onChange: () => persist() });
  initPresentNav({
    onArrive: (s) => window.dispatchEvent(new CustomEvent('fumoca:navArrive', { detail: s })),
    onChange: () => { renderNavManager(); persist(); },
  });
  setMagEditable(true);

  const saved = loadLocal();
  if (saved?.poster && window.FumocaPoster) {
    try {
      if (saved.poster.preset) window.FumocaPoster.setPreset(saved.poster.preset);
      if (saved.poster.composition) window.FumocaPoster.updateComposition(saved.poster.composition);
      window.FumocaPoster.setEnabled(!!saved.poster.enabled);
    } catch (error) { console.warn('[Poster Composer] Could not restore saved composition', error); }
  }
  if (saved?.magazine?.length) importMagazine(saved.magazine);
  if (saved?.nav?.length) importStops(saved.nav);

  const tryMount = () => { mountPanel(); renderNavManager(); renderTextManager(); };
  tryMount();
  [500, 1200, 2500].forEach((t) => setTimeout(tryMount, t));

  // When user clicks Present tab, remount into that panel
  document.addEventListener('click', (e) => {
    const t = e.target.closest?.('[data-tab], button, a, .tab');
    if (!t) return;
    const label = (t.textContent || '').toLowerCase();
    if (label.includes('present') || t.getAttribute('data-tab') === 'present') {
      setTimeout(tryMount, 100);
      setTimeout(syncPresentActive, 120);
    }
  });

  window.addEventListener('fumoca:hotspotActivate', (ev) => {
    const h = ev.detail;
    if (!h || !Number.isFinite(h.wx)) return;
    flyToStop({ id: h.id, label: h.title, wx: h.wx, wy: h.wy, wz: h.wz, zoom: h.zoom || 1.35 });
  });

  window.FumocaPresent = {
    save: persist,
    copyViewerLink,
    applyPreset,
    clearText,
    exportMagazine,
    exportStops,
    addText,
    removeNavStop,
    clearNavStops,
  };
}

if (typeof window !== 'undefined') {
  const boot = () => {
    if (window.__fumocaPresentTabBooted) return;
    // Only on editor-like pages
    if (!/\/edit/i.test(location.pathname) && !document.body?.classList?.contains('editor')) {
      // still allow if present tools wanted
    }
    window.__fumocaPresentTabBooted = true;
    try { initPresentTab(); } catch (e) { console.warn('[present-tab]', e); }
  };
  if (document.readyState === 'complete') setTimeout(boot, 400);
  else window.addEventListener('load', () => setTimeout(boot, 400));
}
