/**
 * YouTube-style: video uploaded in the editor is stored and stays with the splat.
 * Viewer loads it automatically and can switch Stack / Split / PIP / BG.
 */
(function () {
  const BUCKET = 'nif-videos';

  async function uploadToR2(file) {
    const r2 = window.r2 || (await import('../r2Client.js')).r2;
    const key = `review/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const res = await r2.from(BUCKET).upload(key, file, { contentType: file.type || 'video/mp4' });
    if (res?.error) throw res.error;
    return res.publicUrl || r2.publicUrl(BUCKET, res.fileKey || key);
  }

  async function saveToRecord(url, layout) {
    const id = new URLSearchParams(location.search).get('nifId')
      || window.currentRecord?.id
      || sessionStorage.getItem('fumoc_current_nif');
    if (!id || !window.supabase) return;
    const { data } = await window.supabase.from('nif_files').select('meta').eq('id', id).maybeSingle();
    const meta = { ...(data?.meta || {}), reviewVideo: { url, layout: layout || 'split' } };
    await window.supabase.from('nif_files').update({ meta }).eq('id', id);
    console.log('[FUMOCA] review video saved', url);
  }

  function showStatus(msg) {
    let s = document.getElementById('fvpStatus');
    if (!s) {
      s = document.createElement('div');
      s.id = 'fvpStatus';
      s.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0a0c10;color:#c8ff00;padding:8px 16px;border-radius:8px;z-index:100;font:600 13px system-ui;';
      document.body.appendChild(s);
    }
    s.textContent = msg;
    s.style.display = 'block';
    setTimeout(() => { s.style.display = 'none'; }, 4000);
  }

  async function handleFile(file) {
    showStatus('Uploading video…');
    try {
      const url = await uploadToR2(file);
      await saveToRecord(url, 'split');
      if (window.FumocaReviewVideo?.set) window.FumocaReviewVideo.set(url, { layout: 'split' });
      if (window.fumocaSetLayout) window.fumocaSetLayout('split');
      showStatus('Video saved — it will play in the viewer');
    } catch (e) {
      console.error(e);
      showStatus('Upload failed: ' + (e.message || e));
    }
  }

  function hookUpload() {
    document.querySelectorAll('button').forEach((b) => {
      if (b.dataset.persistHook) return;
      if (/upload from device/i.test(b.textContent)) {
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

  // Viewer: load saved video + layout switcher
  async function loadInViewer() {
    if (document.getElementById('viewport')) return; // editor
    const id = new URLSearchParams(location.search).get('nifId');
    if (!id || !window.supabase) return;
    const { data } = await window.supabase.from('nif_files').select('meta').eq('id', id).maybeSingle();
    const rv = data?.meta?.reviewVideo;
    if (!rv?.url) return;
    const layout = rv.layout || 'split';
    if (window.FumocaReviewVideo?.set) window.FumocaReviewVideo.set(rv.url, { layout });
    setTimeout(() => window.fumocaSetLayout?.(layout), 600);
    addSwitcher();
    console.log('[FUMOCA] viewer loaded saved video');
  }

  function addSwitcher() {
    if (document.getElementById('fvpSwitcher')) return;
    const bar = document.createElement('div');
    bar.id = 'fvpSwitcher';
    bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:60;background:rgba(8,10,14,.85);padding:6px;border-radius:12px;';
    ['stack', 'split', 'pip', 'bg', 'off'].forEach((l) => {
      const b = document.createElement('button');
      b.textContent = l.toUpperCase();
      b.style.cssText = 'background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.15);border-radius:7px;padding:6px 12px;font:700 11px system-ui;cursor:pointer;';
      b.onclick = () => window.fumocaSetLayout?.(l);
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  window.addEventListener('load', () => {
    setTimeout(hookUpload, 500);
    setTimeout(loadInViewer, 1200);
  });
  setInterval(hookUpload, 2500);
})();
