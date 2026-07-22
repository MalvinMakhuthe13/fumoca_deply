# FUMOCA — Deploy Guide

## Architecture

```
User scans → Kaggle encodes → .fumoc uploaded to Supabase Storage
                                          ↓
                         viewer-core.html?id=<uuid>
                                          ↓
                              sdk/fumoc-player.js
                         (decode + render, zero deps)
```

**Two viewers:**
- `viewer-core.html` — public embed, just `sdk/fumoc-player.js`, no auth
- `viewer.html` — platform dashboard, authenticated owners, edit tools

**Routing:** all public shares use `viewer-core.html`. The Cloudflare OG worker intercepts both.

---

## 1. Config

Copy `config.example.js` → `config.js` and fill in your values:

```js
window.FUMOCA_CONFIG = {
  supabaseUrl:        'https://YOUR.supabase.co',
  supabaseAnonKey:    'YOUR_ANON_KEY',
  kaggleNotebookUrl:  'https://www.kaggle.com/code/...',
  siteBaseUrl:        'https://fumoca.co.za',
  r2WorkerUrl:        'https://fumoca-r2-storage.YOUR.workers.dev',
  r2ApiSecret:        'YOUR_SECRET',
};
```

---

## 2. Supabase

Apply the schema: `supabase_schema.sql`  
Apply storage policies: `supabase_storage_policies.sql`

The `splats` table needs these columns (all others are in the schema):
- `fumoc_url` — set by the Kaggle worker after encoding
- `splat_url` — legacy fallback for old records
- `thumbnail_url` — JPEG thumbnail

---

## 3. Cloudflare Worker — OG Meta

Rewrites `<meta>` tags for social crawlers (WhatsApp, Twitter, iMessage).

```bash
cd cloudflare
npx wrangler deploy --config wrangler-og.toml

# Set secrets (one-time):
npx wrangler secret put SUPABASE_URL      --config wrangler-og.toml
npx wrangler secret put SUPABASE_ANON_KEY --config wrangler-og.toml
npx wrangler secret put SITE_ORIGIN       --config wrangler-og.toml
```

Routes intercepted:
- `fumoca.co.za/viewer*` (platform dashboard)
- `fumoca.co.za/viewer-core*` (public embed)

---

## 4. Cloudflare Worker — R2 Storage

```bash
cd cloudflare
npx wrangler deploy --config wrangler.toml
npx wrangler secret put R2_API_SECRET --config wrangler.toml
```

---

## 5. Kaggle Encoder

Upload `kaggle/fumoc_encoder.py` and `kaggle/fumoca_kaggle_worker.py` to your Kaggle notebook.

The worker:
1. Polls Supabase for `status = 'queued'` jobs
2. Downloads the `.ply` file
3. Calls `encode_ply_to_fumoc()` → produces `.fumoc`
4. Uploads `.fumoc` to Supabase Storage
5. Updates `splats.fumoc_url` and `splats.status = 'ready'`

Required Kaggle packages: `plyfile open3d DracoPy supabase requests`

---

## 6. SDK — Public Embed

Drop one tag anywhere:

```html
<fumoc-player src="https://your-cdn.com/scene.fumoc"
              style="width:100%;height:500px;"></fumoc-player>
<script src="https://fumoca.co.za/sdk/fumoc-player.js"></script>
```

Or programmatic:

```js
const p = FumocPlayer.mount('#container', { src: 'scene.fumoc' });
p.setViewMode('mesh'); // 'auto' | 'splat' | 'mesh'
p.exportSTL('my-scene');

container.addEventListener('fumoc:ready', e => {
  console.log(e.detail.N, 'Gaussians');
  console.log(e.detail.hasMesh);
});

container.addEventListener('fumoc:tap', e => {
  console.log('Hit world point:', e.detail.worldHit);
});
```

---

## 7. Share URLs

Public share format: `https://fumoca.co.za/s/<splat-id>`

The `_redirects` file maps `/s/:id → /viewer-core.html?id=:id`.

The OG worker rewrites the page title, description and image for that ID before the crawler sees it.

---

## File Map

```
sdk/fumoc-player.js        — standalone player (deploy this to CDN)
viewer-core.html            — public viewer (lean, no auth)
viewer.html                 — platform dashboard (auth required)
embed/viewer.html           — iframe embed wrapper
cloudflare/workers/og-meta.js   — social crawler OG rewriter
cloudflare/workers/r2-storage.js — R2 upload proxy
kaggle/fumoc_encoder.py     — .ply → .fumoc encoder (Python, Kaggle)
kaggle/fumoca_kaggle_worker.py  — job queue processor
config.js                   — site config (not committed, copy from .example)
```
