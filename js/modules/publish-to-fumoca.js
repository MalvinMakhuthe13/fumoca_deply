import r2 from '../r2Client.js';
import { encodeNif } from './nif-format.js';
import { compactGaussianSHSidecar, gaussianSHMetadata } from './nif-sh-sidecar.js';
import { NIFReader, CHUNK } from '../../engine-next/format/NIFSpec.js';
/**
 * FUMOCA Publish Engine v1
 * ══════════════════════════════════════════════════════
 * Handles the full publish flow:
 *   1. Export edited splat as a genuine .nif file (NIFSpec KEYFRAME_GEO chunk —
 *      no .fumoc wrapping, no bare .splat/.ply)
 *   2. Upload to Cloudflare R2
 *   3. Update splat record (edit_completed, visibility, etc.)
 *   4. Redirect to feed card or share sheet
 * ══════════════════════════════════════════════════════
 */

const FumocaPublish = (() => {

  // ── Fetch + decode the file currently open in the editor, so we can carry
  // its vertical and non-geometry chunks (CAMERAS/DEPTH/ALPHA/LAYER/MESH/
  // PRINT/etc.) forward into the re-encoded file. Previously _buildNifBlob
  // rebuilt the .nif from only positions/colors/opacities, which meant every
  // edit+publish silently threw away cameras, depth maps, meshes, the
  // print-ready STL, and reset vertical to 'generic' — regardless of what
  // the capture actually was (automotive/property/fashion/etc). Falls back
  // to {vertical:'generic', passthroughChunks:[]} if there's no original
  // .nif to read from (e.g. brand-new upload, not an edit of an existing one).
  async function _loadOriginalForPassthrough() {
    const url = window._fumocaNifUrl || new URLSearchParams(location.search).get('file');
    let vertical = 'generic';
    const shouldPassThrough = chunk => ![
      CHUNK.KEYFRAME_GEO, CHUNK.META, CHUNK.THUMBNAIL,
      CHUNK.GAUSSIAN_SH, CHUNK.LIDAR_ATTR,
    ].includes(chunk.type);
    // Local file imports already hold decoded chunks in editor state. Keep
    // those if there is no fetchable URL or if a private URL fetch fails.
    let passthroughChunks = Array.isArray(window.S?.nifPassthroughChunks)
      ? window.S.nifPassthroughChunks.filter(shouldPassThrough)
      : [];

    if (url && /\.nif(\?|$)/i.test(url)) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const reader = new NIFReader(buf);
        // Geometry-indexed sidecars must be rebuilt against the current alive
        // point list. Passing the source SH/LiDAR chunks through unchanged would
        // leave stale point counts or misalign attributes after deletion.
        passthroughChunks = reader.chunks.filter(shouldPassThrough);
        vertical = reader.header?.vertical || 'generic';
      } catch (e) {
        console.warn('[Publish] Could not read original .nif for passthrough — proceeding without it:', e.message);
      }
    }

    // A hinge/slide authored this session via NIFHingeAuthorPanel lives only
    // in memory until now — the fetch above reads whatever PHYSICS chunk is
    // still on disk, which doesn't have it yet. Splice the in-session one in
    // so it actually gets persisted on this publish, instead of silently
    // vanishing the moment the tab closes.
    if (window._fumocaAuthoredPhysicsChunk) {
      passthroughChunks = passthroughChunks.filter(c => c.type !== CHUNK.PHYSICS);
      passthroughChunks.push(window._fumocaAuthoredPhysicsChunk);
    }

    // Same fix for MeshEngine.calibrateScale() — see mesh-engine.js. Without
    // this, a manual in-editor scale correction never reaches the exported
    // file, so the passed-through CALIBRATION chunk stays stale relative to
    // the mesh geometry it now describes.
    if (window._fumocaEditorCalibrationChunk) {
      passthroughChunks = passthroughChunks.filter(c => c.type !== CHUNK.CALIBRATION);
      passthroughChunks.push(window._fumocaEditorCalibrationChunk);
    }

    return { vertical, passthroughChunks };
  }

  // ── Collect current edit state, encode as a real .nif ─────────────────────
  function _encodeCurrentSplatRows(S, aliveIndices) {
    const rows = new Uint8Array(aliveIndices.length * 32);
    const view = new DataView(rows.buffer);
    const clamp01 = value => Math.max(0, Math.min(1, value));
    for (let row = 0; row < aliveIndices.length; row++) {
      const i = aliveIndices[row], o = row * 32;
      const xyz = [S.positions?.[i * 3], S.positions?.[i * 3 + 1], S.positions?.[i * 3 + 2]];
      if (xyz.some(value => !Number.isFinite(value))) {
        throw new Error(`Cannot publish: point ${i} has non-finite position data.`);
      }
      for (let c = 0; c < 3; c++) view.setFloat32(o + c * 4, xyz[c], true);
      for (let c = 0; c < 3; c++) {
        const scale = S.scaleXYZ?.[i * 3 + c] ?? S.scale?.[i] ?? 0.01;
        if (!Number.isFinite(scale) || scale <= 0) throw new Error(`Cannot publish: point ${i} has invalid scale data.`);
        view.setFloat32(o + 12 + c * 4, Math.max(1e-6, scale), true);
      }
      for (let c = 0; c < 3; c++) {
        const painted = S.paintColors?.[i * 3 + c];
        const value = painted != null && painted >= 0 ? painted : (S.colors?.[i * 3 + c] ?? 0.7);
        if (!Number.isFinite(value)) throw new Error(`Cannot publish: point ${i} has invalid colour data.`);
        rows[o + 24 + c] = Math.round(clamp01(value) * 255);
      }
      const opacity = S.opacity?.[i] ?? 1;
      if (!Number.isFinite(opacity)) throw new Error(`Cannot publish: point ${i} has invalid opacity data.`);
      rows[o + 27] = Math.round(clamp01(opacity) * 255);
      const q = S.rotation
        ? Array.from(S.rotation.subarray(i * 4, i * 4 + 4))
        : [1, 0, 0, 0];
      const qLength = Math.hypot(...q);
      if (q.length !== 4 || !Number.isFinite(qLength) || qLength < 1e-8) {
        throw new Error(`Cannot publish: point ${i} has invalid rotation data.`);
      }
      for (let c = 0; c < 4; c++) {
        const normalized = q[c] / qLength;
        rows[o + 28 + c] = Math.max(0, Math.min(255, Math.round(normalized * 128 + 128)));
      }
    }
    return rows;
  }

  function _compactLidarAttributes(S, aliveIndices) {
    const compact = source => source ? aliveIndices.map(i => source[i] ?? 0) : null;
    const intensity = S.lidarIntensity ? Uint16Array.from(compact(S.lidarIntensity)) : null;
    const classification = S.lidarClassification ? Uint8Array.from(compact(S.lidarClassification)) : null;
    const returnNumber = S.lidarReturnNumber ? Uint8Array.from(compact(S.lidarReturnNumber)) : null;
    return intensity || classification || returnNumber ? { intensity, classification, returnNumber } : null;
  }

  async function _buildNifBlob({ title, description, parentMeta } = {}) {
    const S = window.S;
    if (!S?.alive || !S.positions) throw new Error('No splat loaded');

    const aliveIndices = [];
    for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) aliveIndices.push(i);
    if (!aliveIndices.length) throw new Error('Cannot publish an empty scene: no live points remain.');

    const sourceMeta = {
      ...(S.nifMeta && typeof S.nifMeta === 'object' ? S.nifMeta : {}),
      ...(parentMeta && typeof parentMeta === 'object' ? parentMeta : {}),
    };
    const gaussianSH = compactGaussianSHSidecar({
      indices: aliveIndices,
      attributes: S.shAttributes || [],
      coefficients: S.shCoefficients,
      pointCount: S.alive.length,
      paintColors: S.paintColors,
      colors: S.colors,
    });
    if (sourceMeta.gaussian_sh && !gaussianSH) {
      throw new Error('Publishing blocked: metadata declares Gaussian SH data but the coefficient sidecar is unavailable.');
    }
    const gaussianShMeta = gaussianSH ? gaussianSHMetadata(gaussianSH, S.shAttributes) : null;
    const meta = {
      ...sourceMeta,
      ...(gaussianShMeta ? { gaussian_sh: gaussianShMeta } : {}),
      title: title || window._fumocaCurrentRecord?.title || S.fileName || 'Untitled',
      description: description ?? sourceMeta.description ?? window._fumocaCurrentRecord?.description ?? '',
    };
    const editorScene = window._fumocaSerializeEditorSceneMetadata?.(aliveIndices);
    if (editorScene) meta.editor_scene = editorScene;
    else if (sourceMeta.editor_scene) delete meta.editor_scene; // Never publish stale point-index mappings.

    const { vertical, passthroughChunks } = await _loadOriginalForPassthrough();
    const rows = _encodeCurrentSplatRows(S, aliveIndices);
    const compactIndices = Array.from({ length: aliveIndices.length }, (_, i) => i);
    const buf = encodeNif({
      sourceBuffer: rows,
      aliveIndices: compactIndices,
      rowSize: 32,
      meta,
      vertical,
      gaussianSH: gaussianSH || undefined,
      lidarAttributes: _compactLidarAttributes(S, aliveIndices),
      passthroughChunks,
    });
    return new Blob([buf], { type: 'application/octet-stream' });
  }

  // ── Main publish function ─────────────────────────────
  async function publish({ title, description, visibility = 'public', onProgress } = {}) {
    // Try every possible location for the Supabase client
    let sb = window._fumocaSupabase || window.supabase;
    if (!sb) {
      try {
        const mod = await import('../supabaseClient.js');
        sb = mod.supabase;
        window._fumocaSupabase = sb;
      } catch(e) { /* config missing — will throw below with a helpful message */ }
    }
    const S = window.S;
    const rec = window._fumocaCurrentRecord;

    if (!sb) throw new Error(
      'Supabase not connected — make sure config.js is loaded before edit.html modules. ' +
      'Check that window.FUMOCA_CONFIG is set with your supabaseUrl and supabaseAnonKey.'
    );
    if (!S?.alive) throw new Error('No splat loaded in editor');

    if (visibility === 'followers') {
      throw new Error('Followers-only access is not implemented yet. Choose Public or Private so access is enforced correctly.');
    }

    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user?.id) throw new Error('Sign in before publishing this NIF.');
    if (rec?.user_id && rec.user_id !== user.id) throw new Error('You cannot publish an asset owned by another user.');

    const splatId = rec?.id || new URLSearchParams(location.search).get('splatId');
    const aliveCount = Array.from(S.alive).filter(Boolean).length;

    // Reload the latest row before merging META so concurrent Studio actions
    // (mobile widgets, open-state variants, thumbnails, etc.) are not erased by
    // a stale in-memory record during publish.
    let existingMeta = rec?.meta && typeof rec.meta === 'object' ? rec.meta : {};
    if (splatId) {
      const { data: latestRecord, error: latestError } = await sb.from('nif_files')
        .select('id,user_id,r2_key,is_public,title,description,meta').eq('id', splatId).eq('user_id', user.id).maybeSingle();
      if (latestError || !latestRecord) {
        throw new Error(latestError?.message || 'The NIF record could not be reloaded or is not owned by the current user.');
      }
      existingMeta = latestRecord.meta && typeof latestRecord.meta === 'object' ? latestRecord.meta : {};
      window._fumocaCurrentRecord = { ...(window._fumocaCurrentRecord || {}), ...latestRecord, meta: existingMeta };
    }

    onProgress?.('Preparing splat…', 10);

    // 1. Build a genuine .nif blob (no .fumoc, no bare .splat/.ply)
    const blob = await _buildNifBlob({ title, description, parentMeta: existingMeta });
    onProgress?.('Uploading…', 20);

    // 2. Upload to storage
    const timestamp = Date.now();
    // Existing assets use an owner-checked edited derivative key. New assets
    // must start under the authenticated user's prefix or the Worker rejects them.
    const path = splatId
      ? `${splatId}/edited_${timestamp}.nif`
      : `${user.id}/edited_${timestamp}.nif`;

    // ── Upload to Cloudflare R2 (replaces supabase.storage) ─────────────────
    const { publicUrl, fileKey, error: uploadError } = await r2
      .from('nif-files')
      .upload(path, blob, { contentType: 'application/octet-stream' });

    if (uploadError) throw new Error('R2 upload failed: ' + uploadError.message);

    onProgress?.('Registering…', 70);

    // 4. Update or create the DB record — against nif_files, the real, live
    // table (confirmed against production; `splats` does not exist there).
    // r2_key stores the storage key, not a public URL — the same convention
    // reconstruction_jobs/pipeline.py already uses.
    const payload = {
      r2_key: fileKey,
      is_public: visibility === 'public',
      gaussian_count: aliveCount,
      updated_at: new Date().toISOString(),
      meta: {
        ...existingMeta,
        title: title || window._fumocaCurrentRecord?.title || rec?.title || S.fileName || 'Untitled Splat',
        description: description ?? window._fumocaCurrentRecord?.description ?? rec?.description ?? '',
        publish_visibility: visibility,
        publish_status: 'published',
      },
    };
    if (title) payload.title = title;
    if (description !== undefined) payload.description = description;

    let finalId = splatId;
    if (splatId) {
      const { data: updated, error } = await sb.from('nif_files').update(payload)
        .eq('id', splatId).eq('user_id', user.id).select('id').maybeSingle();
      if (error || !updated?.id) {
        try { await r2.from('nif-files').remove([fileKey]); } catch (cleanupError) {
          console.warn('[Publish] Failed to clean up an unregistered derivative', cleanupError?.message || cleanupError);
        }
        throw new Error(error?.message || 'Could not update the owned NIF record. The publish was not completed.');
      }
    } else {
      const { data: newRec, error } = await sb.from('nif_files').insert({
        ...payload,
        user_id: user.id,
        title: title || S.fileName || 'Untitled Splat',
        created_at: new Date().toISOString(),
      }).select('id').single();
      if (error || !newRec?.id) {
        try { await r2.from('nif-files').remove([fileKey]); } catch (cleanupError) {
          console.warn('[Publish] Failed to clean up an unregistered NIF', cleanupError?.message || cleanupError);
        }
        throw new Error(error?.message || 'Could not register the new NIF. The publish was not completed.');
      }
      finalId = newRec.id;
    }

    // Keep Studio's in-memory record synchronized with the committed database
    // state so subsequent edits do not overwrite freshly published metadata.
    window._fumocaCurrentRecord = {
      ...(window._fumocaCurrentRecord || {}),
      id: finalId,
      user_id: user.id,
      r2_key: fileKey,
      is_public: visibility === 'public',
      gaussian_count: aliveCount,
      title: payload.title || title || window._fumocaCurrentRecord?.title || rec?.title || S.fileName || 'Untitled Splat',
      description: payload.description ?? description ?? window._fumocaCurrentRecord?.description ?? rec?.description ?? '',
      meta: payload.meta,
    };
    window._fumocaCanonicalFileUrl = publicUrl;

    onProgress?.('Published!', 100);

    return {
      success: true,
      splatId: finalId,
      publicUrl,
      gaussianCount: aliveCount,
      feedUrl: `feed.html`,
      viewerUrl: `viewer.html?nifId=${encodeURIComponent(finalId)}`,
    };
  }

  // ── Build the publish UI panel ────────────────────────
  function buildPublishPanel(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = `
      <div class="section">
        <div class="sec-head">
          <span class="sec-label">🚀 Publish to Fumoca</span>
        </div>
        <div class="sec-body">
          <div class="hint" style="margin-bottom:12px;">
            Turn this edited splat into a shareable, discoverable asset on the Fumoca feed.
          </div>

          <div class="ctrl-row" style="margin-bottom:6px;">
            <span class="ctrl-label">Title</span>
          </div>
          <input type="text" id="pubTitle" placeholder="Give your splat a name…"
            style="width:100%;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.06);
                   border:1px solid rgba(255,255,255,.12);color:#fff;font-size:13px;margin-bottom:8px;">

          <div class="ctrl-row" style="margin-bottom:6px;">
            <span class="ctrl-label">Visibility</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px;" id="pubVisGrid">
            <button class="pub-vis-btn active" data-vis="public"
              onclick="document.querySelectorAll('.pub-vis-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');"
              style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;
                     background:rgba(200,255,0,.14);border:1px solid rgba(200,255,0,.4);color:#c8ff00;">🌍 Public</button>
            <button class="pub-vis-btn" data-vis="followers"
              onclick="document.querySelectorAll('.pub-vis-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');"
              style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;
                     background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#ccc;">👥 Followers</button>
            <button class="pub-vis-btn" data-vis="private"
              onclick="document.querySelectorAll('.pub-vis-btn').forEach(b=>b.classList.remove('active'));this.classList.add('active');"
              style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;
                     background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#ccc;">🔒 Private</button>
          </div>

          <div id="pubProgress" style="display:none;margin-bottom:10px;">
            <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;">
              <span id="pubProgressLabel">Preparing…</span>
              <span id="pubProgressPct">0%</span>
            </div>
            <div style="height:4px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;">
              <div id="pubProgressBar" style="height:100%;width:0;background:#c8ff00;transition:width .3s;"></div>
            </div>
          </div>

          <button id="pubBtn" onclick="window.FumocaPublish._handlePublishClick()"
            style="width:100%;padding:12px;border-radius:10px;font-weight:800;font-size:14px;cursor:pointer;
                   background:linear-gradient(135deg,#c8ff00,#80d400);color:#040508;border:none;
                   letter-spacing:.04em;transition:opacity .2s;">
            🚀 PUBLISH TO FUMOCA
          </button>

          <div id="pubResult" style="display:none;margin-top:10px;padding:10px;border-radius:8px;
               background:rgba(200,255,0,.08);border:1px solid rgba(200,255,0,.3);font-size:12px;"></div>
        </div>
      </div>`;
  }

  // ── Handle the publish button click ──────────────────
  async function _handlePublishClick() {
    const btn = document.getElementById('pubBtn');
    const progress = document.getElementById('pubProgress');
    const result = document.getElementById('pubResult');
    const title = document.getElementById('pubTitle')?.value?.trim();
    const visBtn = document.querySelector('.pub-vis-btn.active');
    const visibility = visBtn?.dataset.vis || 'public';

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Publishing…'; }
    if (progress) progress.style.display = 'block';
    if (result) result.style.display = 'none';

    try {
      const out = await publish({
        title,
        visibility,
        onProgress: (label, pct) => {
          const lbl = document.getElementById('pubProgressLabel');
          const p = document.getElementById('pubProgressPct');
          const bar = document.getElementById('pubProgressBar');
          if (lbl) lbl.textContent = label;
          if (p) p.textContent = `${pct}%`;
          if (bar) bar.style.width = `${pct}%`;
        }
      });

      if (result) {
        result.style.display = 'block';
        result.innerHTML = `
          ✅ <strong>Published!</strong> ${(out.gaussianCount || 0).toLocaleString()} Gaussians live on Fumoca.<br>
          <a href="${out.feedUrl}" style="color:#c8ff00;text-decoration:none;font-weight:700;">→ View on Feed</a>
          &nbsp;·&nbsp;
          <a href="${out.viewerUrl}" style="color:#0ef;text-decoration:none;font-weight:700;">→ Open Viewer</a>`;
      }

      window.dispatchEvent(new CustomEvent('fumoca:splatPublished', { detail: out }));

    } catch (err) {
      if (result) {
        result.style.display = 'block';
        result.style.background = 'rgba(255,80,80,.08)';
        result.style.borderColor = 'rgba(255,80,80,.3)';
        result.innerHTML = `⚠️ Publish failed: ${err.message}`;
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 PUBLISH TO FUMOCA'; }
      if (progress) setTimeout(() => { progress.style.display = 'none'; }, 2000);
    }
  }

  return { publish, buildPublishPanel, _handlePublishClick };
})();

window.FumocaPublish = FumocaPublish;
export default FumocaPublish;
