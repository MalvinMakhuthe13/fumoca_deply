/**
 * FUMOCA Camera Paths & Bookmarks
 *
 * Named camera angles for:
 *  - Presentation / cinematic reveal in the viewer
 *  - Capture guide (phone shows “next angle”)
 *  - NIF presentation chunk (when encoder is ready)
 *
 * Stores pose as { position: [x,y,z], target: [x,y,z], fov, name, id }.
 */

const STORAGE_KEY = 'fumoca_camera_paths_v1';
const escapeHtml = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function uid() {
  return 'cam_' + Math.random().toString(36).slice(2, 10);
}

function loadStore() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/**
 * Read current Three.js-style camera if present on window.
 */
export function captureCurrentPose(name = 'Angle') {
  const cam = window._fumocaCamera || window._fumocaViewer?._camera || window.S?.camera;
  const controls = window._fumocaControls || window._fumocaViewer?.controls;

  if (!cam) {
    throw new Error('Camera not ready — load a splat first');
  }

  const pos = cam.position
    ? [cam.position.x, cam.position.y, cam.position.z]
    : [0, 0, 5];
  let target = [0, 0, 0];
  if (controls?.target) {
    target = [controls.target.x, controls.target.y, controls.target.z];
  }

  return {
    id: uid(),
    name,
    position: pos,
    target,
    fov: cam.fov ?? 50,
    createdAt: Date.now(),
  };
}

export function applyPose(pose) {
  const cam = window._fumocaCamera || window._fumocaViewer?._camera;
  const controls = window._fumocaControls || window._fumocaViewer?.controls;
  if (!cam || !pose) return false;

  if (cam.position?.set) {
    cam.position.set(pose.position[0], pose.position[1], pose.position[2]);
  }
  if (typeof pose.fov === 'number' && cam.fov != null) {
    cam.fov = pose.fov;
    cam.updateProjectionMatrix?.();
  }
  if (controls?.target?.set) {
    controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
    controls.update?.();
  }
  return true;
}

export function listPaths(assetKey = 'default') {
  const store = loadStore();
  return store[assetKey] || { bookmarks: [], path: [] };
}

export function saveBookmark(pose, assetKey = 'default') {
  const store = loadStore();
  if (!store[assetKey]) store[assetKey] = { bookmarks: [], path: [] };
  store[assetKey].bookmarks.push(pose);
  saveStore(store);
  return pose;
}

export function setPathOrder(ids, assetKey = 'default') {
  const store = loadStore();
  if (!store[assetKey]) store[assetKey] = { bookmarks: [], path: [] };
  store[assetKey].path = ids;
  saveStore(store);
}

export function removeBookmark(id, assetKey = 'default') {
  const store = loadStore();
  const data = store[assetKey];
  if (!data) return;
  data.bookmarks = data.bookmarks.filter((b) => b.id !== id);
  data.path = data.path.filter((x) => x !== id);
  saveStore(store);
}

/**
 * Export path for capture guide / NIF metadata.
 */
export function exportPathJSON(assetKey = 'default') {
  const data = listPaths(assetKey);
  const ordered = data.path.length
    ? data.path.map((id) => data.bookmarks.find((b) => b.id === id)).filter(Boolean)
    : data.bookmarks;
  return {
    version: 1,
    assetKey,
    angles: ordered,
    exportedAt: new Date().toISOString(),
  };
}

/**
 * Simple UI mount into a container element.
 */
export function mountCameraPathUI(container, { assetKey = 'default', onStatus } = {}) {
  if (!container) return;

  function render() {
    const data = listPaths(assetKey);
    container.innerHTML = `
      <div class="section" style="border:none;padding:0">
        <div class="btn-grid col2" style="margin-bottom:8px">
          <button type="button" class="ac-btn lime full" id="cpAdd">📌 Save current angle</button>
          <button type="button" class="ac-btn full" id="cpExport">Export path JSON</button>
        </div>
        <button type="button" class="ac-btn cyan full" id="cpPresent" style="margin-bottom:8px">▶ Open as presentation</button>
        <div class="hint" style="margin-bottom:8px">
          Save hero angles as slides. Open presentation for meetings, or embed present.html in PowerPoint / Google slides.
        </div>
        <div id="cpList" style="display:flex;flex-direction:column;gap:6px"></div>
      </div>`;

    const list = container.querySelector('#cpList');
    if (!data.bookmarks.length) {
      list.innerHTML = `<div class="hint">No angles yet — frame the subject and click Save.</div>`;
    } else {
      data.bookmarks.forEach((b, idx) => {
        const row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;gap:6px;padding:8px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)';
        row.innerHTML = `
          <span style="flex:1;font-size:12px;font-weight:600">${escapeHtml(b.name || 'Angle ' + (idx + 1))}${b.notes ? ' · 📝' : ''}</span>
          <button type="button" class="ac-btn" data-go="${escapeHtml(b.id)}" style="padding:4px 8px">Go</button>
          <button type="button" class="ac-btn" data-del="${escapeHtml(b.id)}" style="padding:4px 8px;color:var(--rose)">✕</button>`;
        list.appendChild(row);
      });
    }

    container.querySelector('#cpAdd')?.addEventListener('click', () => {
      try {
        const name = prompt('Name this slide / angle', `Slide ${data.bookmarks.length + 1}`) || `Slide ${data.bookmarks.length + 1}`;
        const notes = prompt('Speaker notes (optional)', '') || '';
        const pose = captureCurrentPose(name);
        pose.notes = notes;
        saveBookmark(pose, assetKey);
        onStatus?.(`Saved “${name}”`);
        render();
      } catch (err) {
        onStatus?.(err.message);
      }
    });

    
    container.querySelector('#cpPresent')?.addEventListener('click', () => {
      const sid = new URLSearchParams(location.search).get('splatId') || assetKey;
      const url = new URL('present.html', location.href);
      if (sid && sid !== 'default') url.searchParams.set('splatId', sid);
      window.open(url.href, '_blank');
      onStatus?.('Opened presentation viewer');
    });

    container.querySelector('#cpExport')?.addEventListener('click', () => {
      const json = exportPathJSON(assetKey);
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fumoca-camera-path-${assetKey}.json`;
      a.click();
      onStatus?.('Camera path exported');
    });

    list.querySelectorAll('[data-go]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pose = data.bookmarks.find((b) => b.id === btn.getAttribute('data-go'));
        if (pose && applyPose(pose)) onStatus?.(`Moved to “${pose.name}”`);
      });
    });
    list.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        removeBookmark(btn.getAttribute('data-del'), assetKey);
        render();
      });
    });
  }

  render();
  return { render, captureCurrentPose, applyPose, exportPathJSON };
}

if (typeof window !== 'undefined') {
  window.FUMOCA_CameraPaths = {
    captureCurrentPose,
    applyPose,
    listPaths,
    saveBookmark,
    exportPathJSON,
    mountCameraPathUI,
  };
}
