import r2 from '../r2Client.js';
import { encodeNif } from './nif-format.js';
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
    let passthroughChunks = [];

    if (url && /\.nif(\?|$)/i.test(url)) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        const reader = new NIFReader(buf);
        passthroughChunks = reader.chunks.filter(c =>
          c.type !== CHUNK.KEYFRAME_GEO && c.type !== CHUNK.META && c.type !== CHUNK.THUMBNAIL);
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
  async function _buildNifBlob({ title, description, reviewVideo, skipLiveReview } = {}) {
    const S = window.S;
    if (!S?.alive) throw new Error('No splat loaded');

    const meta = { title: title || S.fileName || 'Untitled', description: description || '' };
    if (reviewVideo?.url) meta.reviewVideo = reviewVideo;
    const { vertical, passthroughChunks } = await _loadOriginalForPassthrough();

    // PLY source. A gaussian PLY already has per-point size and rotation in
    // the editor. Keep those. Only a plain point cloud gets one shared size.
    if (S.fileType === 'ply') {
      const alive = [];
      for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) alive.push(i);
      const positions   = new Float32Array(alive.length * 3);
      const colors01    = new Float32Array(alive.length * 3);
      const opacities01 = new Float32Array(alive.length);
      const scalesLinear = S.scaleXYZ ? new Float32Array(alive.length * 3) : null;
      const quats = S.rotation ? new Float32Array(alive.length * 4) : null;
      alive.forEach((i, row) => {
        const pc = S.paintColors;
        const r = pc && pc[i*3]   >= 0 ? pc[i*3]   : S.colors[i*3];
        const g = pc && pc[i*3+1] >= 0 ? pc[i*3+1] : S.colors[i*3+1];
        const b = pc && pc[i*3+2] >= 0 ? pc[i*3+2] : S.colors[i*3+2];
        positions[row*3]   = S.positions[i*3];
        positions[row*3+1] = S.positions[i*3+1];
        positions[row*3+2] = S.positions[i*3+2];
        colors01[row*3]   = r; colors01[row*3+1] = g; colors01[row*3+2] = b;
        opacities01[row]  = S.opacity[i];
        const fallback = S.scale?.[i] || 0.01;
        if (scalesLinear) {
          scalesLinear[row*3]   = S.scaleXYZ[i*3]   || fallback;
          scalesLinear[row*3+1] = S.scaleXYZ[i*3+1] || fallback;
          scalesLinear[row*3+2] = S.scaleXYZ[i*3+2] || fallback;
        }
        if (quats) {
          quats[row*4]   = S.rotation[i*4]   ?? 1;
          quats[row*4+1] = S.rotation[i*4+1] ?? 0;
          quats[row*4+2] = S.rotation[i*4+2] ?? 0;
          quats[row*4+3] = S.rotation[i*4+3] ?? 0;
        }
      });
      const buf = encodeNif({ positions, colors01, opacities01, scalesLinear, quats, meta, vertical, passthroughChunks, skipLiveReview: !!skipLiveReview });
      return new Blob([buf], { type: 'application/octet-stream' });
    }

    // .splat source: filter alive Gaussians, pack straight into NIF KEYFRAME_GEO
    if (!S.sourceBuffer) throw new Error('No source buffer');
    const aliveIndices = [];
    for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) aliveIndices.push(i);
    const buf = encodeNif({
      sourceBuffer: new Uint8Array(S.sourceBuffer),
      aliveIndices,
      rowSize: S.splatRowSize,
      meta,
      vertical,
      passthroughChunks,
      skipLiveReview: !!skipLiveReview,
    });
    return new Blob([buf], { type: 'application/octet-stream' });
  }

  // ── Main publish function ─────────────────────────────
  async function publish({ title, description, visibility = 'public', includeReview = false, onProgress } = {}) {
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

    const splatId = rec?.id || new URLSearchParams(location.search).get('splatId');
    const aliveCount = Array.from(S.alive).filter(Boolean).length;

    onProgress?.(includeReview ? 'Uploading review video…' : 'Publishing without video…', 8);
    let review = null;
    if (includeReview) {
      const hasLocalReview = !!(window._fumocaReviewFile || (window.FumocaReviewVideo?.getSrc?.() || '').startsWith('blob:'));
      try {
        review = await window.FumocaReviewVideo?.ensurePublic?.();
      } catch (err) {
        console.warn('[Publish] review video upload failed', err);
        if (hasLocalReview) throw new Error('Review video did not upload. Keep this tab open and publish again.');
      }
      if (!review) review = window.FumocaReviewVideo?.meta?.() || null;
      if (!review?.url) throw new Error('Choose With video only after uploading a review, or publish Without video.');
      review = { ...review, include: true };
      console.info('[Publish] review video attached', review.url);
    }
    onProgress?.('Preparing splat…', 12);
    const blob = await _buildNifBlob({ title, description, reviewVideo: includeReview ? review : null, skipLiveReview: !includeReview });
    onProgress?.('Uploading…', 20);

    // 2. Upload to storage
    const timestamp = Date.now();
    // Path: {splatId}/edited_{ts}.nif — under the real R2 'nif-files' bucket
    // (comment previously said "splat-files", a pre-R2-migration bucket name
    // that doesn't exist — the actual .from('nif-files') call below was
    // already correct, just the comment was stale).
    const path = splatId
      ? `${splatId}/edited_${timestamp}.nif`
      : `new/upload_${timestamp}.nif`;

    // ── Upload to Cloudflare R2 (replaces supabase.storage) ─────────────────
    const { publicUrl, fileKey, error: uploadError } = await r2
      .from('nif-files')
      .upload(path, blob, { contentType: 'application/octet-stream' });

    if (uploadError) throw new Error('R2 upload failed: ' + uploadError.message);

    // Optional original Gaussian PLY companion for the public Spark renderer.
    // Keep publish successful if a source file was not retained in this session.
    let viewPlyKey = null;
    let sourcePlyBytes = window.S?.gaussianSourceBytes || window._fumocaLastGaussianBytes || null;
    const sourceName = String(window.S?.fileName || '').toLowerCase();

    // Prefer the edited full-fidelity PLY exported by Spark. The NIF's
    // KEYFRAME_GEO is a compact preview representation and does not carry SH
    // colour coefficients; the companion PLY is the viewer's fidelity source.
    // Export filters deleted Gaussians and applies editor transforms while
    // preserving all other PLY properties (including f_rest_* SH coefficients).
    if (window.S?.isGaussianPly && window.FumocaSparkGaussian?.isEnabled?.()) {
      try {
        sourcePlyBytes = window.FumocaSparkGaussian.exportEditedBytes(window.S);
        console.info('[Publish] Using edited full-fidelity Gaussian PLY for Spark viewer:', sourcePlyBytes.byteLength, 'bytes');
      } catch (err) {
        console.error('[Publish] Edited Gaussian export failed; refusing a stale companion PLY:', err);
        throw new Error('Could not export the edited high-fidelity Gaussian source. Nothing was published; please reload the editor and try again.');
      }
    }
    if (sourcePlyBytes && (window.S?.isGaussianPly || sourceName.endsWith('.ply') || sourceName.endsWith('.splat'))) {
      try {
        const viewPath = splatId
          ? `${splatId}/view_${timestamp}.ply`
          : `new/view_${timestamp}.ply`;
        const viewBlob = new Blob([sourcePlyBytes], { type: 'application/octet-stream' });
        const { fileKey: companionKey, error: companionError } = await r2
          .from('nif-files')
          .upload(viewPath, viewBlob, { contentType: 'application/octet-stream' });
        if (!companionError && companionKey) {
          viewPlyKey = companionKey;
          console.info('[Publish] Spark companion PLY uploaded:', viewPlyKey);
        } else {
          console.warn('[Publish] Companion PLY upload skipped:', companionError?.message || 'no key returned');
        }
      } catch (companionErr) {
        console.warn('[Publish] Companion PLY upload failed; NIF publish continues:', companionErr?.message || companionErr);
      }
    } else {
      console.info('[Publish] No original Gaussian PLY bytes retained; publishing NIF only.');
    }

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
    };
    if (title) payload.title = title;
    if (description) payload.description = description;
    if (includeReview && review?.url) {
      payload.meta = { ...(rec?.meta || rec?.metadata || {}), includeReview: true, reviewVideo: { ...review, include: true } };
    } else {
      const cleaned = { ...(rec?.meta || rec?.metadata || {}) };
      delete cleaned.reviewVideo;
      cleaned.includeReview = false;
      payload.meta = cleaned;
    }
    if (viewPlyKey) {
      payload.meta = {
        ...(payload.meta || rec?.meta || rec?.metadata || {}),
        view_ply_r2_key: viewPlyKey,
        viewer_engine: 'spark',
        published_from: 'studio_gaussian',
      };
    }

    let finalId = splatId;
    if (payload.meta?.reviewVideo) payload.meta.reviewVideo.boundId = splatId || null;
    if (splatId) {
      const { error } = await sb.from('nif_files').update(payload).eq('id', splatId);
      if (error) console.warn('[Publish] DB update failed:', error.message);
    } else {
      // Create new record
      const { data: { user } } = await sb.auth.getUser().catch(() => ({ data: {} }));
      const { data: newRec, error } = await sb.from('nif_files').insert({
        ...payload,
        user_id: user?.id,
        title: title || S.fileName || 'Untitled Splat',
        created_at: new Date().toISOString(),
      }).select().single();
      if (!error && newRec) {
        finalId = newRec.id;
        if (payload.meta?.reviewVideo) {
          payload.meta.reviewVideo.boundId = newRec.id;
          await sb.from('nif_files').update({ meta: payload.meta }).eq('id', newRec.id);
        }
      }
    }

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

          <div class="ctrl-row" style="margin-bottom:6px;">
            <span class="ctrl-label">Review video</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:12px;" id="pubReviewGrid">
            <button type="button" class="pub-review-btn active" data-review="without"
              style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(200,255,0,.14);border:1px solid rgba(200,255,0,.4);color:#c8ff00;">Without video</button>
            <button type="button" class="pub-review-btn" data-review="with"
              style="padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#ccc;">With video</button>
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
    el.querySelectorAll('.pub-review-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.pub-review-btn').forEach((b) => {
          b.classList.remove('active');
          b.style.background = 'rgba(255,255,255,.05)';
          b.style.borderColor = 'rgba(255,255,255,.1)';
          b.style.color = '#ccc';
        });
        btn.classList.add('active');
        btn.style.background = 'rgba(200,255,0,.14)';
        btn.style.borderColor = 'rgba(200,255,0,.4)';
        btn.style.color = '#c8ff00';
      });
    });
  }

  // ── Handle the publish button click ──────────────────
  async function _handlePublishClick() {
    const btn = document.getElementById('pubBtn');
    const progress = document.getElementById('pubProgress');
    const result = document.getElementById('pubResult');
    const title = document.getElementById('pubTitle')?.value?.trim();
    const visBtn = document.querySelector('.pub-vis-btn.active');
    const visibility = visBtn?.dataset.vis || 'public';
    const includeReview = document.querySelector('.pub-review-btn.active')?.dataset.review === 'with';

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Publishing…'; }
    if (progress) progress.style.display = 'block';
    if (result) result.style.display = 'none';

    try {
      const out = await publish({
        title,
        visibility,
        includeReview,
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
