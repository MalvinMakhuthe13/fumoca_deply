/**
 * FUMOCA Studio Modes — single mental model for the editor.
 *
 * Modes group tools so the UI stays calm (SuperSplat/Kiri-like focus,
 * not a wall of buttons). Other modules listen for 'fumoca:mode'.
 *
 * Usage:
 *   import { StudioModes } from './studio-modes.js';
 *   StudioModes.init({ toolbarEl, leftTabsEl });
 *   StudioModes.set('clean');
 */
export const MODES = [
  {
    id: 'navigate',
    label: 'Navigate',
    icon: '🌐',
    hint: 'Orbit · pan · zoom · inspect',
    tools: ['toolOrbit', 'toolPan', 'toolZoom'],
    leftTabs: ['tools', 'layers'],
  },
  {
    id: 'edit',
    label: 'Edit',
    icon: '✏️',
    hint: 'Select · brush · paint · transform',
    tools: ['toolBox', 'toolLasso', 'toolMagic', 'toolBrushErase', 'toolBrushSelect', 'toolPaint', 'toolSmear', 'toolMove', 'toolScale', 'toolRotate', 'toolCrop'],
    leftTabs: ['tools', 'select'],
  },
  {
    id: 'clean',
    label: 'Clean',
    icon: '✨',
    hint: 'Floaters · noise · gaps · sparse boost',
    tools: [],
    leftTabs: ['clean'],
  },
  {
    id: 'mesh',
    label: 'Mesh & Print',
    icon: '🧊',
    hint: 'Extract mesh · fill holes · STL / print',
    tools: [],
    leftTabs: ['mesh'],
  },
  {
    id: 'present',
    label: 'Present',
    icon: '🎬',
    hint: 'Camera angles · paths · capture guide',
    tools: [],
    leftTabs: ['present'],
  },
  {
    id: 'import',
    label: 'Import',
    icon: '📥',
    hint: 'Splat · PLY · LiDAR · merge',
    tools: [],
    leftTabs: ['import'],
  },
];

let _current = 'navigate';
let _bar = null;

function emit(id) {
  document.dispatchEvent(new CustomEvent('fumoca:mode', { detail: { mode: id } }));
}

function setActiveButtons(mode) {
  const def = MODES.find((m) => m.id === mode);
  if (!def) return;

  // Mode bar
  document.querySelectorAll('[data-studio-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-studio-mode') === mode);
  });

  // Optional: highlight only relevant tool buttons (others stay usable)
  if (def.tools.length) {
    document.querySelectorAll('#toolbar .tool-btn').forEach((btn) => {
      const id = btn.id;
      if (!id) return;
      const relevant = def.tools.includes(id);
      btn.style.opacity = relevant || mode === 'navigate' || mode === 'edit' ? '1' : '0.45';
    });
  } else {
    document.querySelectorAll('#toolbar .tool-btn').forEach((btn) => {
      btn.style.opacity = '0.55';
    });
  }

  // Left tabs: show preferred tab if present
  const preferred = def.leftTabs[0];
  const tabBtn = document.querySelector(`#leftTabs .ptab[data-tab="${preferred}"]`);
  if (tabBtn) tabBtn.click();
}

export const StudioModes = {
  get current() {
    return _current;
  },

  set(id) {
    if (!MODES.some((m) => m.id === id)) return;
    _current = id;
    setActiveButtons(id);
    emit(id);
  },

  /**
   * Inject a slim mode bar under the main toolbar.
   */
  mountBar(parent = document.getElementById('toolbar')) {
    if (!parent || document.getElementById('studioModeBar')) return;

    const bar = document.createElement('div');
    bar.id = 'studioModeBar';
    bar.setAttribute('role', 'tablist');
    bar.innerHTML = MODES.map(
      (m) => `
      <button type="button" class="studio-mode-btn${m.id === _current ? ' active' : ''}"
              data-studio-mode="${m.id}" title="${m.hint}" role="tab">
        <span class="studio-mode-icon">${m.icon}</span>
        <span class="studio-mode-label">${m.label}</span>
      </button>`
    ).join('');

    // Insert after toolbar
    parent.insertAdjacentElement('afterend', bar);
    _bar = bar;

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-studio-mode]');
      if (!btn) return;
      StudioModes.set(btn.getAttribute('data-studio-mode'));
    });

    // Minimal CSS once
    if (!document.getElementById('studioModeBarStyles')) {
      const style = document.createElement('style');
      style.id = 'studioModeBarStyles';
      style.textContent = `
        #studioModeBar {
          position: fixed; top: calc(var(--topbar-h, 58px) + var(--toolbar-h, 50px));
          left: 0; right: 0; z-index: 39;
          display: flex; gap: 4px; align-items: center;
          padding: 6px 14px; height: 40px;
          background: rgba(4,5,10,.92); border-bottom: 1px solid rgba(255,255,255,.08);
          backdrop-filter: blur(12px); overflow-x: auto;
        }
        .studio-mode-btn {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 8px; border: 1px solid transparent;
          background: transparent; color: rgba(255,255,255,.55);
          font: 600 12px/1 Outfit, system-ui, sans-serif; cursor: pointer;
          white-space: nowrap; transition: .15s ease;
        }
        .studio-mode-btn:hover { color: #f0f0f0; background: rgba(255,255,255,.06); }
        .studio-mode-btn.active {
          color: #d4ff00; background: rgba(212,255,0,.1);
          border-color: rgba(212,255,0,.28);
        }
        .studio-mode-icon { font-size: 14px; }
        /* Push shell down for mode bar */
        #shell { top: calc(var(--topbar-h, 58px) + var(--toolbar-h, 50px) + 40px) !important; }
        #statusBar, .viewport-floating { /* keep relative to shell */ }
      `;
      document.head.appendChild(style);
    }

    setActiveButtons(_current);
  },

  init() {
    this.mountBar();
    this.set(_current);
  },
};

// Auto-init when loaded as classic script (defer)
if (typeof window !== 'undefined') {
  window.FUMOCA_StudioModes = StudioModes;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => StudioModes.init());
  } else {
    // Toolbar may not exist yet if this runs early — retry shortly
    setTimeout(() => StudioModes.init(), 0);
  }
}
