/**
 * FUMOCA Asset Parts Engine v61
 * ═══════════════════════════════════════════════════════════════════
 * Structured interactive assets — primarily cars but designed for
 * any segmented object (restaurant zones, retail shelves, etc.)
 *
 * Car parts: body, wheel_fl, wheel_fr, wheel_rl, wheel_rr,
 *            rim_fl … rim_rr, door_driver, door_passenger,
 *            hood, trunk, interior, headlights, taillights
 *
 * Features:
 *   - Part registry with bounds in splat coordinate space
 *   - Toggle part visibility
 *   - Exploded view: separates parts radially for storytelling
 *   - Swap options: show alternate rim/paint splat overlays
 *   - Door animation: animates camera to open-door view
 *   - Deep-dive: focuses on a single part with cinematic fly-in
 *   - All state persisted live to Supabase asset_parts table
 * ═══════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';

const FumocaAssetParts = (() => {

  let _parts    = [];   // loaded from asset_parts table
  let _record   = null;
  let _exploded = false;
  let _originalPositions = new Map(); // partId → {x,y,z}

  // ── Load parts from DB ────────────────────────────────────────────
  async function loadParts(splatRecord) {
    _record = splatRecord;
    const sb = window._fumocaSupabase;
    if (!sb || !splatRecord?.id) return [];

    const { data, error } = await sb.from('asset_parts')
      .select('*')
      .eq('splat_id', splatRecord.id)
      .order('part_name');

    // 404 = table doesn't exist yet (run V63_PUBLISH_FLOW_SCHEMA.sql) — fail silently
    if (error?.code === '42P01' || error?.message?.includes('does not exist')) {
      console.info('[AssetParts] asset_parts table not found — run V63_PUBLISH_FLOW_SCHEMA.sql to enable');
      _parts = [];
    } else {
      _parts = data || [];
    }

    // Also load from scene_parts JSONB if asset_parts table is empty
    if (!_parts.length && splatRecord.scene_parts) {
      _parts = Object.entries(splatRecord.scene_parts).map(([name, cfg]) => ({
        id: `local_${name}`,
        part_name: name,
        part_type:  cfg.type || 'static',
        bounds:     cfg.bounds || null,
        visible:    cfg.visible !== false,
        swap_options: cfg.swap_options || [],
      }));
    }

    window.dispatchEvent(new CustomEvent('fumoca:partsLoaded', { detail: { parts: _parts } }));
    return _parts;
  }

  // ── Toggle part visibility ────────────────────────────────────────
  async function togglePart(partName, visible) {
    const part = _parts.find(p => p.part_name === partName);
    if (!part) return;
    part.visible = visible ?? !part.visible;

    // Tell renderer to show/hide the Gaussian region
    const renderer = window._fumocaRenderer || window._fumocaViewer;
    if (renderer && typeof renderer.setRegionVisible === 'function' && part.bounds) {
      renderer.setRegionVisible(part.bounds, part.visible);
    }

    // Persist
    if (part.id && !part.id.startsWith('local_') && window._fumocaSupabase) {
      await window._fumocaSupabase.from('asset_parts')
        .update({ visible: part.visible })
        .eq('id', part.id);
    }

    window.dispatchEvent(new CustomEvent('fumoca:partToggled', { detail: { partName, visible: part.visible } }));
  }

  // ── Exploded view ─────────────────────────────────────────────────
  function explode(factor = 1.4) {
    _exploded = true;
    const renderer = window._fumocaRenderer || window._fumocaViewer;
    if (!renderer) return;

    // Radially push each part outward from the splat centre
    const centre = new THREE.Vector3(0, 0, 0);
    _parts.forEach(part => {
      if (!part.bounds) return;
      const partCentre = new THREE.Vector3(
        ((part.bounds.min?.x||0) + (part.bounds.max?.x||0)) / 2,
        ((part.bounds.min?.y||0) + (part.bounds.max?.y||0)) / 2,
        ((part.bounds.min?.z||0) + (part.bounds.max?.z||0)) / 2,
      );
      const dir    = partCentre.clone().sub(centre).normalize();
      const offset = dir.multiplyScalar(factor * 0.8);

      _originalPositions.set(part.id, { x: 0, y: 0, z: 0 });

      if (typeof renderer.translateRegion === 'function') {
        renderer.translateRegion(part.bounds, offset.x, offset.y, offset.z);
      }
    });

    window.dispatchEvent(new CustomEvent('fumoca:exploded', { detail: { factor } }));
  }

  function unexplode() {
    _exploded = false;
    const renderer = window._fumocaRenderer || window._fumocaViewer;
    if (!renderer) return;

    _parts.forEach(part => {
      if (!part.bounds) return;
      const orig = _originalPositions.get(part.id) || { x: 0, y: 0, z: 0 };
      if (typeof renderer.translateRegion === 'function') {
        renderer.translateRegion(part.bounds, -orig.x, -orig.y, -orig.z);
      }
    });

    _originalPositions.clear();
    window.dispatchEvent(new CustomEvent('fumoca:unexploded'));
  }

  // ── Deep dive: cinematic focus on one part ────────────────────────
  function deepDive(partName) {
    const part = _parts.find(p => p.part_name === partName);
    if (!part?.bounds) return;

    const cam      = window._fumocaViewerCamera || window._fumocaViewer?.camera;
    const controls = window._fumocaViewerControls || window._fumocaViewer?.controls;
    if (!cam) return;

    const cx = ((part.bounds.min?.x||0) + (part.bounds.max?.x||0)) / 2;
    const cy = ((part.bounds.min?.y||0) + (part.bounds.max?.y||0)) / 2;
    const cz = ((part.bounds.min?.z||0) + (part.bounds.max?.z||0)) / 2;
    const sz  = Math.max(
      (part.bounds.max?.x||1)-(part.bounds.min?.x||0),
      (part.bounds.max?.y||1)-(part.bounds.min?.y||0),
      (part.bounds.max?.z||1)-(part.bounds.min?.z||0)
    );
    const dist = Math.max(0.4, sz * 2.2);

    // Use camera-engine if available
    if (window._fumocaCameraEngine?.flyToHotspot) {
      window._fumocaCameraEngine.flyToHotspot({ wx: cx, wy: cy, wz: cz, zoom: 2.2 });
      return;
    }

    // Fallback: manual lerp
    const startPos    = cam.position.clone();
    const endTarget   = new THREE.Vector3(cx, cy, cz);
    const endPos      = endTarget.clone().add(new THREE.Vector3(dist*0.5, dist*0.35, dist*0.7));
    const startTarget = controls?.target?.clone() || new THREE.Vector3();
    const t0 = performance.now();
    const duration = 1400;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 3);
      cam.position.lerpVectors(startPos, endPos, e);
      if (controls?.target?.lerpVectors) controls.target.lerpVectors(startTarget, endTarget, e);
      controls?.update?.();
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── Swap: apply an alternate part variant ─────────────────────────
  async function swapPart(partName, swapIndex) {
    const part = _parts.find(p => p.part_name === partName);
    if (!part) return;
    const opts = Array.isArray(part.swap_options) ? part.swap_options : [];
    const opt  = opts[swapIndex];
    if (!opt) return;

    // Save the active swap to the splat's scene_parts
    if (_record?.id && window._fumocaSupabase) {
      const sceneParts = { ...(_record.scene_parts || {}) };
      sceneParts[partName] = { ...(sceneParts[partName] || {}), active_swap: swapIndex };
      await window._fumocaSupabase.from('splats')
        .update({ scene_parts: sceneParts })
        .eq('id', _record.id);
    }

    window.dispatchEvent(new CustomEvent('fumoca:partSwapped', { detail: { partName, opt, swapIndex } }));
  }

  // ── Build UI panel for parts (call after loadParts) ───────────────
  function buildPartsUI(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !_parts.length) return;

    container.innerHTML = _parts.map(part => {
      const swaps = Array.isArray(part.swap_options) ? part.swap_options : [];
      return `
        <div class="part-row" data-part="${part.part_name}">
          <div class="part-header">
            <span class="part-label">${_formatPartName(part.part_name)}</span>
            <label class="part-toggle">
              <input type="checkbox" ${part.visible ? 'checked' : ''}
                onchange="FumocaAssetParts.togglePart('${part.part_name}', this.checked)">
              <span class="toggle-track"></span>
            </label>
          </div>
          <div class="part-actions">
            <button onclick="FumocaAssetParts.deepDive('${part.part_name}')"
              class="part-btn">🔍 Deep Dive</button>
            ${swaps.length ? `
              <select onchange="FumocaAssetParts.swapPart('${part.part_name}', this.value)"
                class="part-select">
                <option value="">Swap variant…</option>
                ${swaps.map((s,i) => `<option value="${i}">${s.label||'Option '+(i+1)}</option>`).join('')}
              </select>` : ''}
          </div>
        </div>`;
    }).join('');

    // Add explode button at top
    const explodeBtn = document.createElement('button');
    explodeBtn.className = 'part-btn neon';
    explodeBtn.textContent = '💥 Exploded View';
    explodeBtn.style.cssText = 'width:100%;margin-bottom:12px;';
    explodeBtn.addEventListener('click', () => {
      if (_exploded) { unexplode(); explodeBtn.textContent = '💥 Exploded View'; }
      else           { explode();  explodeBtn.textContent = '🔁 Reassemble'; }
    });
    container.prepend(explodeBtn);
  }

  function _formatPartName(name) {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // Auto-load when record loads
  window.addEventListener('fumoca:recordLoaded', e => {
    const rec = e.detail?.record || e.detail || window._fumocaCurrentRecord;
    if (rec) loadParts(rec);
  });

  return {
    loadParts,
    togglePart,
    explode,
    unexplode,
    deepDive,
    swapPart,
    buildPartsUI,
    getParts: () => _parts.slice(),
    isExploded: () => _exploded,
  };

})();

window.FumocaAssetParts = FumocaAssetParts;
export default FumocaAssetParts;
