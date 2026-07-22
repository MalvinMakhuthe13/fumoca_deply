import r2 from '../r2Client.js';
/**
 * FUMOCA Teaser Video Generator v65
 * ═══════════════════════════════════════════════════════════════════
 * Records the real renderer canvas — point cloud → Gaussian reveal
 * → 360° orbit → hero hold. Uploads to preview-videos bucket via
 * the already-initialised window._fumocaSupabase client (never
 * creates its own Supabase client — avoids placeholder URL errors).
 *
 * After recording:
 *  • Shows a full-screen preview modal so you can watch & share
 *  • Auto-downloads the .webm locally
 *  • Uploads to Supabase and saves teaser_video_url on the splat row
 * ═══════════════════════════════════════════════════════════════════
 */

const FumocaTeaserVideo = (() => {

  // ── helpers ──────────────────────────────────────────────────────
  const delay = ms => new Promise(r => setTimeout(r, ms));

  function _getSb() {
    return window._fumocaSupabase || window.supabase || null;
  }

  function _getCanvas() {
    // Always use the THREE renderer canvas — it's the real scene
    return (
      document.querySelector('#viewport canvas') ||
      document.querySelector('canvas')
    );
  }

  // ── Preview modal ─────────────────────────────────────────────────
  function _showPreviewModal(blobUrl, uploadedUrl) {
    // Remove any previous modal
    document.getElementById('fumoca-teaser-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'fumoca-teaser-modal';
    modal.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,0.92);
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:'Outfit',sans-serif;
    `;

    const shareUrl = uploadedUrl || '';
    modal.innerHTML = `
      <div style="position:relative;width:min(480px,92vw);background:#0d0d10;border-radius:18px;overflow:hidden;border:1px solid rgba(200,255,0,.25);box-shadow:0 0 60px rgba(200,255,0,.12);">
        <div style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.07);">
          <span style="font-size:14px;font-weight:800;color:#c8ff00;letter-spacing:.05em;">🎬 Your Social Teaser</span>
          <button id="teaser-modal-close" style="background:none;border:none;color:rgba(255,255,255,.5);font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;" onmouseover="this.style.background='rgba(255,255,255,.08)'" onmouseout="this.style.background='none'">✕</button>
        </div>
        <video id="teaser-preview-video" autoplay loop muted playsinline controls
          style="width:100%;max-height:60vh;object-fit:contain;background:#000;display:block;"
          src="${blobUrl}"></video>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
          ${shareUrl ? `
          <div style="background:rgba(200,255,0,.07);border:1px solid rgba(200,255,0,.2);border-radius:10px;padding:10px 12px;">
            <div style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:4px;">SHAREABLE LINK</div>
            <div style="display:flex;gap:8px;align-items:center;">
              <span id="teaser-share-url" style="font-size:11px;color:#c8ff00;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${shareUrl}</span>
              <button onclick="navigator.clipboard.writeText('${shareUrl}').then(()=>{this.textContent='✅ Copied';setTimeout(()=>this.textContent='Copy',2000)})"
                style="flex-shrink:0;padding:5px 10px;border-radius:7px;background:rgba(200,255,0,.15);border:1px solid rgba(200,255,0,.3);color:#c8ff00;font-size:11px;font-weight:700;cursor:pointer;">
                Copy
              </button>
            </div>
          </div>` : `
          <div style="background:rgba(255,160,0,.08);border:1px solid rgba(255,160,0,.2);border-radius:10px;padding:10px 12px;font-size:11px;color:rgba(255,200,0,.8);">
            ⚠️ Upload to Supabase failed — video saved locally only. Check that config.js is loaded and the preview-videos bucket exists.
          </div>`}
          <div style="display:flex;gap:8px;">
            <a id="teaser-download-btn" href="${blobUrl}" download="fumoca_teaser.webm"
              style="flex:1;padding:10px;border-radius:10px;background:rgba(200,255,0,.12);border:1px solid rgba(200,255,0,.3);color:#c8ff00;font-size:12px;font-weight:800;text-align:center;text-decoration:none;cursor:pointer;">
              ⬇ Download .webm
            </a>
            ${shareUrl ? `
            <button onclick="navigator.share?.({title:'My 3D Capture',url:'${shareUrl}'}) || navigator.clipboard.writeText('${shareUrl}')"
              style="flex:1;padding:10px;border-radius:10px;background:rgba(255,45,120,.12);border:1px solid rgba(255,45,120,.3);color:#ff2d78;font-size:12px;font-weight:800;cursor:pointer;">
              ↗ Share
            </button>` : ''}
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,.25);text-align:center;line-height:1.4;">
            Ready for Instagram Reels, TikTok, YouTube Shorts &amp; WhatsApp Status
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('teaser-modal-close').onclick = () => modal.remove();
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  // ── Main recording function ───────────────────────────────────────
  async function generateTeaser(splatRecord) {
    const canvas = _getCanvas();
    if (!canvas) { alert('Renderer canvas not found — load a splat first.'); return null; }

    const splatId = splatRecord?.id
      || new URLSearchParams(location.search).get('splatId')
      || null;

    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9' : 'video/webm';

    const chunks = [];
    const stream = canvas.captureStream(60);
    const rec    = new MediaRecorder(stream, { mimeType });
    rec.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };

    console.log('%c[Teaser] Recording started...', 'color:#ff2d78;font-weight:800');
    rec.start(100);

    const gr       = window.FumocaGaussianRenderer;
    const controls = window._fumocaOrbitControls || window.controls;
    const camera   = window._fumocaCamera || window.camera;

    // ── Cinematic sequence ──────────────────────────────────────────

    // Phase 1: dissolve to raw point cloud — hold 2s
    if (gr?.isEnabled()) {
      gr.playDissolve(600);
      await delay(800);
    } else {
      await delay(500);
    }

    // Phase 2: Gaussian reveal — the money shot (2.6s)
    await new Promise(resolve => {
      if (gr) {
        if (!gr.isEnabled()) {
          gr.enable(false);
          if (typeof window.rebuildGeometry === 'function') window.rebuildGeometry();
          setTimeout(() => gr.playReveal(2600, resolve), 80);
        } else {
          gr.playReveal(2600, resolve);
        }
      } else {
        resolve();
      }
    });

    await delay(400);

    // Phase 3: smooth 360° orbit — 5s
    if (camera && controls) {
      const target = controls.target?.clone?.() || new THREE.Vector3();
      const pos    = camera.position.clone().sub(target);
      const radius = pos.length();
      const polar  = Math.atan2(Math.sqrt(pos.x * pos.x + pos.z * pos.z), pos.y);
      const startAz = Math.atan2(pos.x, pos.z);
      const duration = 5000;
      const start    = performance.now();
      await new Promise(resolve => {
        function orbitStep() {
          const t   = Math.min(1, (performance.now() - start) / duration);
          const az  = startAz + t * Math.PI * 2;
          camera.position.set(
            target.x + radius * Math.sin(polar) * Math.sin(az),
            target.y + radius * Math.cos(polar),
            target.z + radius * Math.sin(polar) * Math.cos(az)
          );
          camera.lookAt(target);
          controls.update?.();
          if (t < 1) requestAnimationFrame(orbitStep); else resolve();
        }
        requestAnimationFrame(orbitStep);
      });
    } else {
      await delay(5000);
    }

    // Phase 4: hero hold
    await delay(1200);

    // Stop recording
    await new Promise(r => { rec.onstop = r; rec.stop(); });

    const blob    = new Blob(chunks, { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    // ── Upload to Supabase ──────────────────────────────────────────
    let uploadedUrl = null;
    const sb = _getSb();

    if (sb && splatId) {
      try {
        const path = `teasers/${splatId}/teaser_${Date.now()}.webm`;
        const { publicUrl: _teaserUrl, error } = await r2
          .from('preview-videos')
          .upload(path, blob, { contentType: mimeType });

        if (error) {
          console.error('[Teaser] R2 upload error:', error);
        } else {
          uploadedUrl = _teaserUrl || null;

          if (uploadedUrl) {
            await sb.from('splats')
              .update({ teaser_video_url: uploadedUrl, last_edited_at: new Date().toISOString() })
              .eq('id', splatId);

            if (typeof window.saveLiveEdit === 'function') {
              await window.saveLiveEdit({ teaser_video_url: uploadedUrl });
            }

            console.log(`%c[Teaser] Uploaded → ${uploadedUrl}`, 'color:#c8ff00;font-weight:800');
            window.dispatchEvent(new CustomEvent('fumoca:teaserReady', {
              detail: { splatId, url: uploadedUrl }
            }));
          }
        }
      } catch (err) {
        console.error('[Teaser] Upload failed:', err);
      }
    } else if (!sb) {
      console.warn('[Teaser] Supabase not available — video saved locally only');
    }

    // ── Show preview modal (always — even if upload failed) ─────────
    _showPreviewModal(blobUrl, uploadedUrl);

    console.log('%c[Teaser] Done', 'color:#c8ff00;font-weight:800');
    return uploadedUrl || blobUrl;
  }

  return { generateTeaser, showPreviewModal: _showPreviewModal };
})();

window.FumocaTeaserVideo = FumocaTeaserVideo;
export default FumocaTeaserVideo;
