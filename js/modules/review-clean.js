/**
 * Clean review video. Does not touch the editor until you upload a video.
 * Upload in editor → saved with the splat → plays in viewer.
 * Viewer can switch stack / split / pip.
 */
(function () {
  const BUCKET = 'nif-videos';

  function id() {
    const q = new URLSearchParams(location.search);
    return q.get('id') || q.get('nifId') || null;
  }
  function isEditor() { return !!document.getElementById('viewport'); }
  function host() { return document.getElementById('viewport') || document.getElementById('stage'); }

  function toast(msg) {
    let t = document.getElementById('rcToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rcToast';
      t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#c8ff00;padding:10px 16px;border-radius:8px;z-index:9999;font:600 13px system-ui;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._h);
    t._h = setTimeout(() => t.style.display = 'none', 4000);
  }

  function makePlayer(url) {
    const h = host();
    if (!h) return null;
    let box = document.getElementById('rcVideo');
    if (!box) {
      box = document.createElement('div');
      box.id = 'rcVideo';
      box.innerHTML = '<video playsinline loop muted></video>';
      box.style.cssText = 'position:absolute;background:#000;overflow:hidden;z-index:5;display:none;';
      h.style.position = 'relative';
      h.appendChild(box);
    }
    const v = box.querySelector('video');
    if (url && v.src !== url) { v.src = url; v.play().catch(() => {}); }
    return box;
  }

  function layout(name) {
    const box = document.getElementById('rcVideo');
    const canvas = document.getElementById('viewportCanvas') || document.querySelector('#stage canvas');
    if (!box) return;
    if (name === 'off') { box.style.display = 'none'; if (canvas) canvas.style.cssText = ''; return; }
    box.style.display = 'block';
    const v = box.querySelector('video');
    v.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;';
    if (name === 'split') {
      box.style.cssText = 'position:absolute;top:0;left:0;width:50%;height:100%;background:#000;z-index:5;display:block;';
      if (canvas) canvas.style.cssText = 'position:absolute;top:0;left:50%;width:50%;height:100%;';
    } else if (name === 'stack') {
      box.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:50%;background:#000;z-index:5;display:block;';
      if (canvas) canvas.style.cssText = 'position:absolute;top:50%;left:0;width:100%;height:50%;';
    } else if (name === 'pip') {
      box.style.cssText = 'position:absolute;right:12px;bottom:12px;width:280px;height:158px;background:#000;z-index:20;display:block;border-radius:10px;cursor:grab;';
      if (canvas) canvas.style.cssText = '';
    } else if (name === 'full') {
      box.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:8;display:block;';
    }
    window._rcLayout = name;
  }

  async function upload(file) {
    toast('Uploading…');
    try {
      const r2 = window.r2 || (await import('/js/r2Client.js')).r2;
      const key = 'review/' + Date.now() + '_' + file.name.replace(/\s+/g, '_');
      const res = await r2.from(BUCKET).upload(key, file, { contentType: file.type || 'video/mp4' });
      if (res?.error) throw res.error;
      const url = res.publicUrl || r2.publicUrl(BUCKET, res.fileKey || key);
      const nid = id();
      const sb = window.supabase;
      if (nid && sb) {
        const { data } = await sb.from('nif_files').select('meta').eq('id', nid).maybeSingle();
        const meta = Object.assign({}, data?.meta || {}, { reviewVideo: { url, layout: 'split' } });
        await sb.from('nif_files').update({ meta }).eq('id', nid);
      }
      sessionStorage.setItem('rc_' + nid, url);
      makePlayer(url);
      layout('split');
      toast('Saved. It will play in the viewer.');
    } catch (e) {
      toast('Failed: ' + (e.message || e));
      console.error(e);
    }
  }

  function hookEditor() {
    if (!isEditor()) return;
    document.querySelectorAll('button').forEach((b) => {
      if (b.dataset.rc) return;
      if (/upload from device/i.test(b.textContent || '')) {
        b.dataset.rc = '1';
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'video/*';
          inp.onchange = () => inp.files[0] && upload(inp.files[0]);
          inp.click();
        }, true);
      }
      if (b.dataset.layout && !b.dataset.rcLay) {
        b.dataset.rcLay = '1';
        b.addEventListener('click', () => layout(b.dataset.layout === 'hidden' ? 'off' : b.dataset.layout));
      }
    });
  }

  async function loadViewer() {
    if (isEditor()) return;
    const nid = id();
    if (!nid) return;
    let url = sessionStorage.getItem('rc_' + nid);
    const sb = window.supabase;
    if (sb) {
      try {
        const { data } = await sb.from('nif_files').select('meta').eq('id', nid).maybeSingle();
        if (data?.meta?.reviewVideo?.url) url = data.meta.reviewVideo.url;
      } catch (_) {}
    }
    if (!url) return;
    makePlayer(url);
    layout('split');
    if (document.getElementById('rcSwitch')) return;
    const bar = document.createElement('div');
    bar.id = 'rcSwitch';
    bar.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);display:flex;gap:6px;z-index:60;background:rgba(0,0,0,.8);padding:6px;border-radius:10px;';
    ['split','stack','pip','full','off'].forEach((n) => {
      const b = document.createElement('button');
      b.textContent = n.toUpperCase();
      b.style.cssText = 'background:#222;color:#fff;border:1px solid #444;border-radius:6px;padding:6px 10px;cursor:pointer;font:700 11px system-ui;';
      b.onclick = () => layout(n);
      bar.appendChild(b);
    });
    document.body.appendChild(bar);
  }

  window.addEventListener('load', () => {
    setTimeout(hookEditor, 500);
    setTimeout(loadViewer, 1200);
  });
  setInterval(hookEditor, 2000);
})();
