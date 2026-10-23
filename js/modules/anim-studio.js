/**
 * FUMOCA Animation Studio
 * Click-to-animate parts on any splat: doors, lights, drawers, lids, screens.
 * Works for cars, rooms, products — anything with a hotspot.
 *
 * A clip is: { id, label, key, open, close, sound, camera, glow }
 * Binding a hotspot action { type:'anim', clip:'door_fl' } plays it.
 */
const CLIPS_KEY = 'fumoca:animClips';

const PRESETS = [
  { id: 'door_fl', label: 'Front left door', key: 'door_fl', open: 'open', close: 'closed', sound: 'door', camera: 'left', glow: null },
  { id: 'door_fr', label: 'Front right door', key: 'door_fr', open: 'open', close: 'closed', sound: 'door', camera: 'right', glow: null },
  { id: 'door_rl', label: 'Rear left door', key: 'door_rl', open: 'open', close: 'closed', sound: 'door', camera: 'left', glow: null },
  { id: 'door_rr', label: 'Rear right door', key: 'door_rr', open: 'open', close: 'closed', sound: 'door', camera: 'right', glow: null },
  { id: 'boot', label: 'Boot / trunk', key: 'boot', open: 'open', close: 'closed', sound: 'door', camera: 'rear', glow: null },
  { id: 'lights', label: 'Lights', key: 'lights', open: 'on', close: 'off', sound: 'click', camera: null, glow: 'warm' },
  { id: 'engine', label: 'Engine', key: 'engine', open: 'on', close: 'off', sound: 'engine', camera: null, glow: null },
  { id: 'drawer', label: 'Drawer', key: 'drawer', open: 'open', close: 'closed', sound: 'click', camera: null, glow: null },
  { id: 'lid', label: 'Lid / cover', key: 'lid', open: 'open', close: 'closed', sound: 'click', camera: null, glow: null },
  { id: 'screen', label: 'Screen / IVI', key: 'screen', open: 'on', close: 'off', sound: 'click', camera: null, glow: 'cool' },
];

function loadClips() {
  try {
    const raw = localStorage.getItem(CLIPS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return PRESETS.slice();
}

function saveClips(clips) {
  try { localStorage.setItem(CLIPS_KEY, JSON.stringify(clips)); } catch (_) {}
}

export function getClips() { return loadClips(); }

export function playClip(clipId, ctx = {}) {
  const clip = loadClips().find((c) => c.id === clipId);
  if (!clip) return;
  const cur = window.fumocaState?.get?.(clip.key);
  const next = cur === clip.open ? clip.close : clip.open;
  document.dispatchEvent(new CustomEvent('fumoca:state', {
    detail: { key: clip.key, value: next, clip },
  }));
  if (clip.sound) {
    document.dispatchEvent(new CustomEvent('fumoca:sound', { detail: { name: clip.sound } }));
  }
  if (clip.glow) {
    document.body.dataset.glow = next === clip.open ? clip.glow : '';
  }
  if (clip.camera && typeof window.fumocaEaseCamera === 'function') {
    window.fumocaEaseCamera(clip.camera);
  }
  console.log('[anim]', clip.label, '→', next);
  return next;
}

export function mountAnimPanel(container) {
  if (!container) return;
  const clips = loadClips();
  container.innerHTML = `
    <div class="anim-studio">
      <div class="anim-head">Animation clips</div>
      <p class="anim-note">Click a part in the viewer to play. Add a hotspot with action type <code>anim</code>.</p>
      <ul class="anim-list">
        ${clips.map((c) => `
          <li data-id="${c.id}">
            <button type="button" class="anim-play" data-play="${c.id}">▶</button>
            <span>${c.label}</span>
            <em>${c.key}</em>
          </li>`).join('')}
      </ul>
      <button type="button" id="animAddCustom" class="anim-add">+ Custom clip</button>
    </div>`;
  container.querySelectorAll('[data-play]').forEach((btn) => {
    btn.addEventListener('click', () => playClip(btn.dataset.play));
  });
  container.querySelector('#animAddCustom')?.addEventListener('click', () => {
    const label = prompt('Clip name (e.g. Fridge door)');
    if (!label) return;
    const id = label.toLowerCase().replace(/\s+/g, '_');
    const clips = loadClips();
    clips.push({ id, label, key: id, open: 'open', close: 'closed', sound: 'click', camera: null, glow: null });
    saveClips(clips);
    mountAnimPanel(container);
  });
}

// Global so hotspots can call it
window.fumocaPlayClip = playClip;
