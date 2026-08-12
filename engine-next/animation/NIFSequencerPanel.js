/**
 * NIFSequencerPanel — build, reorder, preview, and export a multi-step
 * animation sequence ("open door → wait → open trunk → wait less → close
 * door"), closing the "no dedicated timeline tool" gap called out in
 * NIFAnimator.js/NIFAnimationSequencer.js.
 * fumoca.co.za · © Fumoca Technologies
 *
 * Deliberately does NOT reach into hotspot-pro.js's internal hotspot state
 * to auto-attach the compiled sequence to a specific hotspot — that module's
 * state management wasn't audited closely enough this session to safely
 * mutate from outside it. Instead this panel gives you the exact JSON to
 * paste into a hotspot's `actions[].action` field, which is real, working,
 * and doesn't risk corrupting hotspot state I don't have full visibility
 * into. Wiring a "save directly to hotspot X" button is a reasonable
 * follow-up once hotspot-pro.js's save path gets the same audit everything
 * else got this session.
 *
 * USAGE
 *   import { mountSequencerPanel } from './NIFSequencerPanel.js';
 *   const panel = mountSequencerPanel({ container, viewer, runAction });
 *   // runAction: pass hotspot-actions.js's exported runAction so preview
 *   // can actually execute the compiled sequence. Not imported directly
 *   // here to avoid a circular dependency with hotspot-actions.js.
 */

import { compileSequence, previewSequence, estimateSequenceDuration } from './NIFAnimationSequencer.js';

const STYLE = `
  font: 13px/1.4 -apple-system, system-ui, sans-serif; color: #e8e8ec;
  background: #1a1a1f; border: 1px solid #333; border-radius: 8px;
  padding: 14px; width: 320px;
`;

export function mountSequencerPanel({ container, viewer, runAction }) {
  if (!container || !viewer || !runAction) {
    throw new Error('mountSequencerPanel requires { container, viewer, runAction }');
  }

  const root = document.createElement('div');
  root.setAttribute('style', STYLE);
  container.appendChild(root);

  /** @type {Array<{layer:string, kind:string, angleDeg:number, distance:number, delayAfter:number}>} */
  let steps = [];

  function renderer() { return viewer._renderer; }
  function layerOptions() {
    return (renderer()?._layers ?? []).filter(l => l.indices?.length).map(l => l.label);
  }

  function addStep() {
    const first = layerOptions()[0];
    if (!first) return;
    steps.push({ layer: first, kind: 'hinge', angleDeg: 60, distance: 0.3, delayAfter: 400 });
    render();
  }

  function moveStep(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    render();
  }

  function removeStep(i) {
    steps.splice(i, 1);
    render();
  }

  function setStatus(msg) {
    const el = root.querySelector('#seqStatus');
    if (el) el.textContent = msg;
  }

  function render() {
    const labels = layerOptions();
    const rows = steps.map((s, i) => `
      <div style="border:1px solid #333; border-radius:6px; padding:8px; margin-bottom:6px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <strong>Step ${i + 1}</strong>
          <span>
            <button data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button data-act="down" data-i="${i}" ${i === steps.length - 1 ? 'disabled' : ''}>↓</button>
            <button data-act="remove" data-i="${i}">✕</button>
          </span>
        </div>
        <select data-field="layer" data-i="${i}" style="width:100%; margin-bottom:4px; background:#111; color:#eee; border:1px solid #333;">
          ${labels.map(l => `<option value="${l}" ${l === s.layer ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <select data-field="kind" data-i="${i}" style="width:100%; margin-bottom:4px; background:#111; color:#eee; border:1px solid #333;">
          <option value="hinge" ${s.kind === 'hinge' ? 'selected' : ''}>Hinge (rotate)</option>
          <option value="slide" ${s.kind === 'slide' ? 'selected' : ''}>Slide</option>
        </select>
        ${s.kind === 'slide'
          ? `<label style="display:block; font-size:11px;">Distance: <input data-field="distance" data-i="${i}" type="number" step="0.05" value="${s.distance}" style="width:60px;"></label>`
          : `<label style="display:block; font-size:11px;">Angle: <input data-field="angleDeg" data-i="${i}" type="number" value="${s.angleDeg}" style="width:60px;">°</label>`
        }
        <label style="display:block; font-size:11px;">Wait after: <input data-field="delayAfter" data-i="${i}" type="number" step="100" value="${s.delayAfter}" style="width:70px;">ms</label>
      </div>
    `).join('');

    root.innerHTML = `
      <div style="font-weight:600; margin-bottom:8px;">Animation sequence</div>
      ${labels.length === 0
        ? `<div style="opacity:.7; margin-bottom:8px;">No animatable layers in this file.</div>`
        : ''}
      ${rows || '<div style="opacity:.6; margin-bottom:8px;">No steps yet.</div>'}
      <button id="seqAdd" ${labels.length === 0 ? 'disabled' : ''} style="width:100%; margin-bottom:8px;">+ Add step</button>
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <button id="seqPreview" style="flex:1;" ${steps.length === 0 ? 'disabled' : ''}>Preview</button>
        <button id="seqExport" style="flex:1;" ${steps.length === 0 ? 'disabled' : ''}>Export JSON</button>
      </div>
      <div id="seqDuration" style="font-size:11px; opacity:.7; margin-bottom:6px;">
        ${steps.length ? `≈ ${(estimateSequenceDuration(steps) / 1000).toFixed(1)}s total` : ''}
      </div>
      <textarea id="seqOutput" readonly style="width:100%; height:90px; display:none; font-family:monospace; font-size:11px; background:#111; color:#8f8; border:1px solid #333;"></textarea>
      <div id="seqStatus" style="margin-top:6px; font-size:11px; opacity:.75; min-height:14px;"></div>
    `;

    root.querySelectorAll('button').forEach(b => {
      b.style.cssText += 'padding:5px 7px; background:#2a2a33; color:#eee; border:1px solid #444; border-radius:5px; cursor:pointer;';
    });

    root.querySelector('#seqAdd')?.addEventListener('click', addStep);

    root.querySelectorAll('button[data-act]').forEach(b => {
      const i = Number(b.dataset.i);
      b.addEventListener('click', () => {
        if (b.dataset.act === 'up') moveStep(i, -1);
        else if (b.dataset.act === 'down') moveStep(i, 1);
        else if (b.dataset.act === 'remove') removeStep(i);
      });
    });

    root.querySelectorAll('[data-field]').forEach(el => {
      el.addEventListener('change', (e) => {
        const i = Number(el.dataset.i);
        const field = el.dataset.field;
        const val = el.type === 'number' ? Number(e.target.value) : e.target.value;
        steps[i][field] = val;
        if (field === 'kind') render(); // swap angle/distance input
      });
    });

    root.querySelector('#seqPreview')?.addEventListener('click', async () => {
      setStatus('Previewing…');
      try {
        await previewSequence(steps, runAction, { viewer });
        setStatus('Done.');
      } catch (e) {
        setStatus(`Preview failed: ${e.message}`);
      }
    });

    root.querySelector('#seqExport')?.addEventListener('click', () => {
      const compiled = compileSequence(steps);
      const out = root.querySelector('#seqOutput');
      out.style.display = 'block';
      out.value = JSON.stringify(compiled, null, 2);
      out.select();
      setStatus("Paste this into a hotspot's actions[].action field.");
    });
  }

  render();

  return {
    getSteps: () => steps.slice(),
    destroy: () => root.remove(),
  };
}
