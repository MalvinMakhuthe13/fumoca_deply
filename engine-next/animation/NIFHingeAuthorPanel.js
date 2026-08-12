/**
 * NIFHingeAuthorPanel — the click-to-set-pivot UI that NIFAnimator.js and
 * NIFHingeAuthor.js's own "still not built" notes explicitly called out as
 * missing. Reuses NIFRenderer's existing click-raycast (onSelect/
 * _bindClickSelect — already wired for hotspot placement, just not for
 * this) to let someone click the actual hinge point on the model instead
 * of only getting a bounding-box guess.
 *
 * fumoca.co.za · © Fumoca Technologies
 *
 * USAGE
 *   import { mountHingeAuthorPanel } from './NIFHingeAuthorPanel.js';
 *   const panel = mountHingeAuthorPanel({
 *     container: document.getElementById('someDiv'),
 *     viewer,          // the live NIFViewer instance
 *   });
 *   // panel.destroy() to unmount
 *
 * This is a real, functional vanilla-JS panel — not a mockup. It:
 *   - Lists every animatable layer in the currently loaded file
 *   - Lets you click "Pick pivot" then click the model itself to set the
 *     exact pivot point (falls back to suggestHingePivot()'s bbox guess if
 *     you don't)
 *   - Lets you preview the hinge live before saving anything
 *   - On Save, writes a real PHYSICS chunk via NIFHingeAuthor.defineHinge()
 *     and hands it to window._fumocaAuthoredPhysicsChunk so
 *     publish-to-fumoca.js's next publish actually persists it (see the
 *     bridge added there in this same change — without it, an authored-but-
 *     unpublished hinge would be silently lost on the next save, since
 *     publish re-reads PHYSICS from the file on disk, not from this panel's
 *     in-memory state).
 */

import { defineHinge, suggestHingePivot } from './NIFHingeAuthor.js';

const STYLE = `
  font: 13px/1.4 -apple-system, system-ui, sans-serif; color: #e8e8ec;
  background: #1a1a1f; border: 1px solid #333; border-radius: 8px;
  padding: 14px; width: 260px;
`;

export function mountHingeAuthorPanel({ container, viewer }) {
  if (!container || !viewer) {
    throw new Error('mountHingeAuthorPanel requires { container, viewer }');
  }

  const root = document.createElement('div');
  root.setAttribute('style', STYLE);
  container.appendChild(root);

  let picking = false;
  let pickedPivot = null;
  let selectedLabel = null;
  let currentAxis = [0, 1, 0];

  function renderer() { return viewer._renderer; }
  function layers()   { return (renderer()?._layers ?? []).filter(l => l.indices?.length); }

  function setStatus(msg) {
    const el = root.querySelector('#hapStatus');
    if (el) el.textContent = msg;
  }

  function render() {
    const opts = layers().map(l =>
      `<option value="${l.label}" ${l.label === selectedLabel ? 'selected' : ''}>${l.label} (${l.count} pts)</option>`
    ).join('');

    root.innerHTML = `
      <div style="font-weight:600; margin-bottom:8px;">Animate a part</div>
      ${layers().length === 0
        ? `<div style="opacity:.7;">No animatable layers in this file — needs a .nif reconstructed with the indices-carrying pipeline (see pipeline.py's split_layers()).</div>`
        : `
        <label style="display:block; margin-bottom:6px;">Layer</label>
        <select id="hapLayer" style="width:100%; margin-bottom:10px; background:#111; color:#eee; border:1px solid #333; padding:4px;">
          <option value="">Choose a layer…</option>
          ${opts}
        </select>

        <div id="hapControls" style="${selectedLabel ? '' : 'display:none;'}">
          <label style="display:block; margin-bottom:4px;">Axis</label>
          <div style="display:flex; gap:4px; margin-bottom:8px;">
            <button data-axis="1,0,0" class="hapAxisBtn">X</button>
            <button data-axis="0,1,0" class="hapAxisBtn">Y (default)</button>
            <button data-axis="0,0,1" class="hapAxisBtn">Z</button>
          </div>

          <label style="display:block; margin-bottom:4px;">Pivot</label>
          <div id="hapPivotReadout" style="font-family:monospace; font-size:11px; opacity:.8; margin-bottom:6px;">
            ${pickedPivot ? pickedPivot.map(n => n.toFixed(3)).join(', ') : '(using bounding-box guess)'}
          </div>
          <button id="hapPickBtn" style="width:100%; margin-bottom:10px;">
            ${picking ? 'Click the model now…' : 'Pick pivot in 3D view'}
          </button>

          <label style="display:block; margin-bottom:4px;">Open angle: <span id="hapAngleVal">60</span>°</label>
          <input id="hapAngle" type="range" min="10" max="150" value="60" style="width:100%; margin-bottom:10px;">

          <div style="display:flex; gap:6px;">
            <button id="hapPreview" style="flex:1;">Preview</button>
            <button id="hapSave" style="flex:1;">Save hinge</button>
          </div>
          <div id="hapStatus" style="margin-top:8px; font-size:11px; opacity:.75; min-height:14px;"></div>
        </div>
      `}
    `;

    root.querySelectorAll('button').forEach(b => {
      b.style.cssText += 'padding:6px 8px; background:#2a2a33; color:#eee; border:1px solid #444; border-radius:5px; cursor:pointer;';
    });

    root.querySelector('#hapLayer')?.addEventListener('change', (e) => {
      selectedLabel = e.target.value || null;
      pickedPivot = null;
      picking = false;
      render();
    });

    root.querySelectorAll('.hapAxisBtn').forEach(b => {
      b.addEventListener('click', () => {
        currentAxis = b.dataset.axis.split(',').map(Number);
        setStatus(`Axis set to [${b.dataset.axis}]`);
      });
    });

    root.querySelector('#hapAngle')?.addEventListener('input', (e) => {
      root.querySelector('#hapAngleVal').textContent = e.target.value;
    });

    root.querySelector('#hapPickBtn')?.addEventListener('click', () => {
      if (!renderer()?.onSelect) {
        setStatus('This renderer build has no click-select support.');
        return;
      }
      picking = true;
      render();
      renderer().onSelect((_index, hit) => {
        pickedPivot = hit.position;
        picking = false;
        renderer().onSelect(null); // disarm — one pick at a time
        render();
        setStatus('Pivot set from click.');
      });
    });

    root.querySelector('#hapPreview')?.addEventListener('click', () => {
      if (!selectedLabel) return;
      const layer = layers().find(l => l.label === selectedLabel);
      const pivot = pickedPivot ?? suggestHingePivot(layer, currentAxis);
      const angleDeg = Number(root.querySelector('#hapAngle').value);
      const ok = renderer()?.playHingeAnimation(selectedLabel, { pivot, axis: currentAxis, angleDeg });
      setStatus(ok ? 'Previewing…' : 'Preview failed — see console.');
    });

    root.querySelector('#hapSave')?.addEventListener('click', () => {
      if (!selectedLabel) return;
      const layer = layers().find(l => l.label === selectedLabel);
      const pivot = pickedPivot ?? suggestHingePivot(layer, currentAxis);
      const angleDeg = Number(root.querySelector('#hapAngle').value);

      const { physics, chunk } = defineHinge(viewer._physics, selectedLabel, {
        axis: currentAxis, pivot, angleMax: angleDeg,
      });

      // Update the live session so preview/other panels see the new
      // definition immediately (rebuild the animator's joint-def index —
      // loadLayers() is cheap, it doesn't touch the GPU buffer).
      viewer._physics = physics;
      renderer()?.loadLayers?.(renderer()._layers, physics);

      // Hand off to publish-to-fumoca.js — see the bridge added there.
      // Without this, the hinge would exist only in this tab's memory and
      // vanish the moment you publish, because publish re-reads PHYSICS
      // from the file that's still on disk, not from here.
      window._fumocaAuthoredPhysicsChunk = chunk;

      setStatus(`Saved. Will be included next time you publish/save — pivot [${pivot.map(n=>n.toFixed(2)).join(', ')}], axis [${currentAxis.join(', ')}], ${angleDeg}°.`);
    });
  }

  render();

  return {
    destroy() {
      renderer()?.onSelect?.(null);
      root.remove();
    },
  };
}
