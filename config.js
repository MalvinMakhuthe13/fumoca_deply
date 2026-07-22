window.FUMOCA_CONFIG = {
  supabaseUrl: 'https://sjxkgdaaknflnviwjbej.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqeGtnZGFha25mbG52aXdqYmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcyNTYsImV4cCI6MjA5MDk2MzI1Nn0.Ycak6EMEvRnRVVkbpVwbAnEBpIgy1Kqz9qWtqK6AL8w',
  kaggleNotebookUrl: 'https://www.kaggle.com/code/malvinmakhuthe/notebook6ce27d38de',
  siteBaseUrl: 'https://fumoca.co.za',

  // ── Cloudflare R2 Storage ──────────────────────────────────────────────────
  r2WorkerUrl: 'https://fumoca-r2-storage.fumocaapp.workers.dev',
  // r2ApiSecret intentionally removed — it was being shipped to every browser
  // (readable via view-source), which let anyone authenticate as your trusted
  // backend and write/delete files in R2. The worker now verifies the user's
  // real Supabase session instead (see js/r2Client.js + cloudflare/workers/
  // r2-storage.js). If this secret was ever live in production, rotate it in
  // the Cloudflare dashboard now — see cloudflare/DEPLOY.md.
};

// ── Local testing self-check ──────────────────────────────────────────────
// This app uses ES modules for most of its interactive JS. Browsers refuse to
// load ES modules over the file:// protocol (a real Chrome/Edge/Firefox CORS
// restriction, not a bug in this app) — so double-clicking an .html file to
// open it directly will silently fail to load most of the page's behavior,
// and can look like "everything is broken." Catch that here and say so
// clearly, instead of leaving someone staring at a page that half-works.
if (window.location.protocol === 'file:') {
  document.addEventListener('DOMContentLoaded', function () {
    var banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:999999',
      'background:#ff4d4d', 'color:#fff', 'font:600 13px/1.5 -apple-system,sans-serif',
      'padding:10px 16px', 'text-align:center',
    ].join(';');
    banner.innerHTML = 'This page won\u2019t work correctly opened directly from a file ' +
      '\u2014 browsers block the scripts this app needs over file://. ' +
      'Run <code style="background:rgba(0,0,0,.25);padding:1px 6px;border-radius:4px;">' +
      './scripts/serve-local.sh</code> (or <code style="background:rgba(0,0,0,.25);padding:1px 6px;border-radius:4px;">' +
      'python3 -m http.server</code>) from the project folder, then open ' +
      '<code style="background:rgba(0,0,0,.25);padding:1px 6px;border-radius:4px;">http://localhost:8000</code> instead.';
    document.documentElement.prepend(banner);
    document.body && (document.body.style.marginTop = banner.offsetHeight + 'px');
  });
}
