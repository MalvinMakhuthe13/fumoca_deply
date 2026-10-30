/**
 * FUMOCA Present Tab — all Present tools live in the Present sidebar section
 * Magazine text · Nav · Review video · Save / share (keeps text for viewer)
 */
import {
  initMagazineText, addText, updateText, removeText, applyPreset, clearText,
  exportAll as exportMagazine, importAll as importMagazine, setEditable as setMagEditable,
} from './present-magazine-text.js?v=20261029-exactfont1';
import {
  initPresentNav, setNavStops, addNavStop, removeNavStop, clearNavStops, flyToStop,
  stopsFromHotspots, exportStops, importStops,
} from './present-nav.js';
import { initMagazineImages, addImage, removeImage, updateImage, armWorldPlacement, cancelPlacement, exportAll as exportImages, importAll as importImages, readImageFile } from './present-image-layer.js?v=20261030-decal1';

const STORAGE_KEY = 'fumoca_present_v1';

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
    images: exportImages(),
    nav: exportStops(),
    reviewLayout: window.FumocaReviewVideo?.getLayout?.() || null,
    reviewUrl: (window.FumocaReviewVideo?.getSrc?.() && !String(window.FumocaReviewVideo.getSrc()).startsWith('blob:'))
      ? window.FumocaReviewVideo.getSrc()
      : null,
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

function copyViewerLink() {
  const data = persist();
  let json;
  try {
    json = btoa(unescape(encodeURIComponent(JSON.stringify({
      magazine: data.magazine,
      images: data.images || [],
      nav: data.nav,
      reviewUrl: data.reviewUrl,
      reviewLayout: data.reviewLayout || 'stack',
    }))));
  } catch {
    json = '';
  }
  const id = idKey();
  let base = window._fumocaShareUrl || `${location.origin}/viewer?nifId=${encodeURIComponent(id === 'default' ? '' : id)}`;
  const url = new URL(base, location.origin);
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

function renderImageManager() {
  const root = document.getElementById('ptpImageManager');
  if (!root) return;
  root.replaceChildren();
  const items = exportImages();
  if (!items.length) { const hint=document.createElement('div'); hint.className='ptp-hint'; hint.textContent='No image layers yet.'; root.appendChild(hint); return; }
  items.forEach((item,index) => {
    const card=document.createElement('div'); card.className='ptp-text-item';
    const title=document.createElement('div'); title.className='ptp-text-heading'; title.textContent=(index+1)+'. '+(item.name||'Image layer');
    const row=document.createElement('div'); row.className='ptp-row';
    const anchor=document.createElement('button'); anchor.type='button'; anchor.dataset.anchorImage=item.id; anchor.textContent=item.mode==='world'?'Re-anchor to splat':'Anchor to splat';
    const remove=document.createElement('button'); remove.type='button'; remove.dataset.removeImage=item.id; remove.className='ptp-danger'; remove.textContent='Remove';
    row.append(anchor,remove);
    const controls=document.createElement('div'); controls.className='ptp-image-fields';
    const widthLabel=document.createElement('label'); widthLabel.textContent='Width';
    const width=document.createElement('input'); width.type='range'; width.min='5'; width.max='60'; width.step='1'; width.value=String(item.width||18); width.dataset.imageWidth=item.id;
    widthLabel.appendChild(width);
    const opacityLabel=document.createElement('label'); opacityLabel.textContent='Opacity';
    const opacity=document.createElement('input'); opacity.type='range'; opacity.min='10'; opacity.max='100'; opacity.step='1'; opacity.value=String(Math.round((item.opacity??1)*100)); opacity.dataset.imageOpacity=item.id;
    opacityLabel.appendChild(opacity);
    const mode=document.createElement('div'); mode.className='ptp-image-mode'; mode.textContent=item.mode==='world'?'3D anchored · follows camera orbit':'Screen layer · fixed to composition';
    controls.append(widthLabel,opacityLabel,mode);
    card.append(title,row,controls); root.appendChild(card);
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
    ['Anton, Impact, sans-serif', 'Anton / Impact'],
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
      <button type="button" data-remove-text="${item.id}" class="ptp-danger">Delete text</button>
    `;
    card.append(heading, fields);
    root.appendChild(card);
  });
}
function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mountPanel() {
  let panel = document.getElementById('fumocaPresentTabPanel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'fumocaPresentTabPanel';
  panel.innerHTML = `
    <div class="ptp-section">
      <div class="ptp-title">Magazine cover text</div>
      <div class="ptp-row">
        <button type="button" data-act="weekly">WEEKLY</button>
        <button type="button" data-act="48hours">48 HOURS</button>
        <button type="button" data-act="product">Product</button>
        <button type="button" data-act="hero">Hero title</button>
        <button type="button" data-act="clear-text">Clear text</button>
        <button type="button" data-act="add-custom-text" class="primary">+ Custom text</button>
      </div>
      <div class="ptp-hint">Add custom text, then drag it in the viewport to position it. Select text below to change its wording, font, size, color and alignment.</div>
    </div>
    <div class="ptp-section">
      <div class="ptp-title">Image & logo layers</div>
      <div class="ptp-row"><button type="button" data-act="add-image" class="primary">＋ Add logo / image</button><button type="button" data-act="cancel-image">Cancel placement</button></div>
      <input id="ptpImageFile" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none"/>
      <div class="ptp-hint">Upload a transparent PNG or other image. Drag it into position, or select “Anchor to splat” and click a visible Gaussian point so it follows that 3D location as you orbit.</div>
      <div id="ptpImageManager"></div>
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

  const host = findPresentHost();
  host.appendChild(panel);
  syncPresentActive();

  const imageInput = panel.querySelector('#ptpImageFile');
  imageInput?.addEventListener('change', async () => {
    const file=imageInput.files?.[0]; if(!file)return;
    try { const src=await readImageFile(file); addImage(src,{name:file.name.replace(/\.[^.]+$/,'')}); renderImageManager(); persist(); }
    catch(err){ alert(err.message || 'Image upload failed.'); }
    imageInput.value='';
  });
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
    else return;
    updateText(field.dataset.textId, patch);
    const heading = field.closest('.ptp-text-item')?.querySelector('.ptp-text-heading');
    if (heading && key === 'text') heading.textContent = field.value || 'Text';
    persist();
  };
  // Browsers fire input inconsistently for select/color controls; support both.
  panel.addEventListener('input', applyTextField);
  panel.addEventListener('change', applyTextField);

  panel.addEventListener('input', e => {
    const width=e.target.closest('[data-image-width]');
    if(width){updateImage(width.dataset.imageWidth,{width:Number(width.value)});persist();return;}
    const opacity=e.target.closest('[data-image-opacity]');
    if(opacity){updateImage(opacity.dataset.imageOpacity,{opacity:Number(opacity.value)/100});persist();}
  });
  panel.addEventListener('click', (e) => {
    const anchor=e.target.closest('button[data-anchor-image]');
    if(anchor){armWorldPlacement(anchor.dataset.anchorImage);alert('Click a visible point on the splat to anchor this image.');return;}
    const removeImageBtn=e.target.closest('button[data-remove-image]');
    if(removeImageBtn){removeImage(removeImageBtn.dataset.removeImage);renderImageManager();persist();return;}

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
    if (act === 'add-image') { imageInput?.click(); return; }
    if (act === 'cancel-image') { cancelPlacement(); return; }
    if (act === 'weekly') applyPreset('weekly');
    if (act === '48hours') applyPreset('48hours');
    if (act === 'product') applyPreset('product');
    if (act === 'hero') applyPreset('hero');
    if (['weekly','48hours','product','hero'].includes(act)) renderTextManager();
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
  initMagazineImages({ editable: true, onChange: () => persist() });
  initPresentNav({
    onArrive: (s) => window.dispatchEvent(new CustomEvent('fumoca:navArrive', { detail: s })),
    onChange: () => { renderNavManager(); persist(); },
  });
  setMagEditable(true);

  const saved = loadLocal();
  if (saved?.magazine?.length) importMagazine(saved.magazine);
  if (saved?.images?.length) importImages(saved.images);
  if (saved?.nav?.length) importStops(saved.nav);

  const tryMount = () => { mountPanel(); renderNavManager(); renderTextManager(); renderImageManager(); };
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
    exportImages,
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
