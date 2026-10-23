/**
 * Video uploaded in editor stays with the splat.
 * Viewer (?id= or ?nifId=) loads it and can switch layouts.
 */
(function () {
  const BUCKET = 'nif-videos';

  function recordId() {
    const q = new URLSearchParams(location.search);
    return q.get('id') || q.get('nifId') || window.currentRecord?.id || null;
  }

  async function getR2() {
    if (window.r2) return window.r2;
    try { const m = await import('/js/r2Client.js'); return m.r2 || m.default; } catch (_) { return null; }
  }
  function getSupabase() {
    return window.supabase || window._fumocaSupabase || null;
  }

  async function uploadToR2(file) {
    const r2 = await getR2();
    if (!r2) throw new Error('storage not ready');
    const key = `review/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const res = await r2.from(BUCKET).upload(key, file, { contentType: file.type || 'video/mp4' });
    if (res?.error) throw res.error;
    return res.publicUrl || r2.publicUrl(BUCKET, res.fileKey || key);
  }

  async function saveToRecord(url, layout) {
    const id = recordId();
    const sb = getSupabase();
    if (!id || !sb) { console.warn('[FUMOCA] no id/supabase', id); return; }
    const { data } = await sb.from('nif_files').select('meta').eq('id', id).maybeSingle();
    const meta = { ...(data?.meta || {}), reviewVideo: { url, layout: layout || 'split', savedAt: Date.now() } };
    const { error } = await sb.from('nif_files').update({ meta }).eq('id', id);
    if (error) console.error('[FUMOCA] save failed', error);
    else console.log('[FUMOCA] review video saved to', id, url);
    sessionStorage.setItem('fumoca_review_' + id, JSON.stringify({ url, layout }));
  }

  function toast(msg) {
    let s = document.getElementById('fvpStatus');
    if (!s) {
      s = document.createElement('div');
      s.id = 'fvpStatus';
      s.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0a0c10;color:#c8ff00;padding:10px 18px;border-radius:10px;z-index:200;font:600 13px system-ui;border:1px solid rgba(200,255,0,.3);';
      document.body.appendChild(s);
    }
    s.textContent = msg;
    s.style.display = 'block';
    clearTimeout(s._t);
    s._t = setTimeout(() => { s.style.display = 'none'; }, 5000);
  }

  async function handleFile(file) {
    toast('Uploading video…');
    try {
      const url = await uploadToR2(file);
      await saveToRecord(url, 'split');
      window.FumocaReviewVideo?.set?.(url, { layout: 'split' });
      window.fumocaSetLayout?.('split');
      toast('Saved. Publish, then the viewer will play it.');
    } catch (e) {
      console.error(e);
      toast('Upload failed: ' + (e.message || e));
    }
  }

  function hookButtons() {
    document.querySelectorAll('button').forEach((b) => {
      if (b.dataset.persistHook) return;
      const label = (b.textContent || '').trim();
      if (/upload from device/i.test(label)) {
        b.dataset.persistHook = '1';
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'video/*';
          input.onchange = () => { if (input.files[0]) handleFile(input.files[0]); };
          input.click();
        }, true);
      }
    });
  }

  async function loadInViewer() {
    if (document.getElementById('viewport')) return;
    const id = recordId();
    if (!id) return;
    let rv = null;
    const cached = sessionStorage.getItem('fumoca_review_' + id);
    if (cached) { try { rv = JSON.parse(cached); } catch (_) {} }
    const sb = getSupabase();
    if (sb) {
      const { data } = await sb.from('nif_files').select('meta').eq('id', id).maybeSingle();
      if (data?.meta?.reviewVideo?.url) rv = data.meta.reviewVideo;
    }
    if (!rv?.url) { console.log('[FUMOCA] no saved review video for', id); return; }
    const layout = rv.layout || 'split';
    window.FumocaReviewVideo?.set?.(rv.url, { layout });
    setTimeout(() => window.fumocaSetLayout?.(layout), 700);
    addSwitcher();
    console.log('[FUMOCA] viewer playing saved video', rv.url);
  }

  function addSwitcher() {
    if (document.getElementById('fvpSwitcher')) return;
    const bar = document.createElement('div');
    bar.id = 'fvpSwitcher';
    bar.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:60;background:rgba(8,10,14,.9);padding:6px;border-radius:12px;border:1px solid rgba(255,255,255,.1);';
    ['stack','split','pip','bg','off'].forEach((l) => {
      const b = document.createElement('button');
      b.textContent = l.toUpperCase();
      b.style.cssText = 'background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:7px;padding:7px 12px;font:700 11px system-ui;cursor:pointer;';
      b.onclick = () => window.fumocaSetLayout?.(l);
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  window.addEventListener('load', () => {
    setTimeout(hookButtons, 400);
    setTimeout(loadInViewer, 1000);
    setTimeout(loadInViewer, 2500);
  });
  setInterval(hookButtons, 3000);
})();
