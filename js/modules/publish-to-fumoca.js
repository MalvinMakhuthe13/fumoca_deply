import r2 from '../r2Client.js';
import { encodeNif } from './nif-format.js';
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

  // ── Collect current edit state, encode as a real .nif ─────────────────────
  function _buildNifBlob({ title, description } = {}) {
    const S = window.S;
    if (!S?.alive) throw new Error('No splat loaded');

    const meta = { title: title || S.fileName || 'Untitled', description: description || '' };

    // PLY source: isotropic point cloud (no per-point scale/rotation)
    if (S.fileType === 'ply') {
      const alive = [];
      for (let i = 0; i < S.alive.length; i++) if (S.alive[i]) alive.push(i);
      const positions   = new Float32Array(alive.length * 3);
      const colors01    = new Float32Array(alive.length * 3);
      const opacities01 = new Float32Array(alive.length);
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
      });
      const buf = encodeNif({ positions, colors01, opacities01, meta, vertical: 'generic' });
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
      vertical: 'generic',
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

    const splatId = rec?.id || new URLSearchParams(location.search).get('splatId');
    const aliveCount = Array.from(S.alive).filter(Boolean).length;

    onProgress?.('Preparing splat…', 10);

    // 1. Build a genuine .nif blob (no .fumoc, no bare .splat/.ply)
    const blob = _buildNifBlob({ title, description });
    onProgress?.('Uploading…', 20);

    // 2. Upload to storage
    const timestamp = Date.now();
    // Path: {splatId}/edited_{ts}.nif — directly under splat-files bucket.
    // NOTE: bucket name/DB column names (splat_url) are unchanged to avoid a
    // schema migration — they now simply point at a .nif URL instead of .splat.
    const path = splatId
      ? `${splatId}/edited_${timestamp}.nif`
      : `new/upload_${timestamp}.nif`;

    // ── Upload to Cloudflare R2 (replaces supabase.storage) ─────────────────
    const { publicUrl, fileKey, error: uploadError } = await r2
      .from('splat-files')
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
    };
    if (title) payload.title = title;
    if (description) payload.description = description;

    let finalId = splatId;
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
      if (!error && newRec) finalId = newRec.id;
    }

    onProgress?.('Published!', 100);

    return {
      success: true,
      splatId: finalId,
      publicUrl,
      gaussianCount: aliveCount,
      feedUrl: `feed.html`,
      viewerUrl: `viewer.html?id=${encodeURIComponent(finalId)}`,
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
