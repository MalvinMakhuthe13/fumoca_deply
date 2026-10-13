# FUMOCA

**3D Gaussian splat platform** for vehicles, property, and events.  
Capture → process → view → share immersive spatial media.

Supabase powers auth, database, storage, and job queue.  
Kaggle (or any GPU worker) processes the heavy reconstruction.  
Static frontend + Cloudflare Workers for R2 storage and OG meta.

---

## Quick start (local)

```bash
# 1. Configure
cp config.example.js config.js
# Edit config.js with your Supabase URL + anon key

# 2. Serve (required — do NOT open .html files via file://)
./scripts/serve-local.sh          # Mac / Linux
# or double-click scripts\serve-local.bat on Windows

# 3. Open
http://localhost:8000/feed.html
```

Browsers block ES modules on `file://`. Always use the local server.

---

## Setup (full)

1. **Config** — copy `config.example.js` → `config.js` and fill in values.
2. **Database** — run in Supabase SQL editor (in order):
   - `supabase_schema.sql`
   - `supabase_storage_policies.sql`
   - optional: `supabase_migration_commerce.sql`, `supabase_migration_embeds.sql`
3. **Storage buckets** (created by the storage policies script):
   - `splat-videos` · `splat-files` · `thumbnails` · `avatars`
4. **Deploy frontend** — any static host (Cloudflare Pages, Netlify, S3, etc.).
5. **Worker** — open the Kaggle notebook (see `docs/KAGGLE_SETUP.md`) and point it at your Supabase project.

More detail: [docs/DEPLOY.md](docs/DEPLOY.md) · [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

## Project layout

```
├── *.html              # App pages (feed, viewer, upload, edit, …)
├── css/                # Design tokens + shared UI
├── js/
│   ├── auth.js
│   ├── supabaseClient.js
│   ├── runtime-config.js
│   ├── r2Client.js
│   └── modules/        # Feature modules (nav, feed, viewer, codecs, …)
├── scripts/            # Local serve helpers
├── cloudflare/         # Workers (R2, OG meta)
├── engine-next/        # Next-gen NIF format, editor, reconstruction (in progress)
├── embed/              # Embeddable viewer / ad player
├── docs/               # Specs, deploy guides, vision
├── supabase_*.sql      # Schema & policies
└── config.example.js   # Template — never commit real config.js
```

---

## Viewer modes

```
viewer.html?mode=car&title=BMW%20M4
viewer.html?mode=property&title=Modern%20Sandton%20Penthouse
viewer.html?mode=event&title=Wedding%20Reception
```

Finished jobs load the real `.ply` from `splats.splat_url` when a `splatId` is present.

---



## Presentations (PowerPoint-style)

Interactive decks over a live 3D scene — for meetings, sales, property tours:

```
present.html?splatId=YOUR_ID
```

- Arrow keys / Space — next slide  
- Camera angles saved in Studio → Present become slides  
- Fullscreen for projectors; embed the same URL in PowerPoint or Google Slides as a live web object  

## Embed (social player)

Professional, Instagram-style chrome for sites and ads:

```html
<iframe
  src="https://your-domain.com/embed/player.html?splatId=YOUR_SPLAT_ID"
  style="width:100%;max-width:420px;aspect-ratio:9/16;border:0;border-radius:16px;overflow:hidden"
  allow="autoplay; fullscreen; web-share"
  allowfullscreen
  loading="lazy"
></iframe>
```

- `embed/player.html` — social UI (author, like, share, caption)
- `embed/viewer.html` — redirects to the player (legacy URLs keep working)
- NIF format: see [docs/NIF.md](docs/NIF.md)

## Status & known limits

- Core consumer flow (upload → queue → Kaggle process → view) is the focus.
- Kaggle sessions are not production-grade always-on workers; long jobs can be interrupted.
- `engine-next/` holds the future NIF/SPAX format work — not yet the default path.
- See `docs/VISION.md` for longer-term product thinking (currently parked).

---

## Docs

| Doc | Purpose |
|-----|---------|
| [docs/KAGGLE_SETUP.md](docs/KAGGLE_SETUP.md) | Worker / notebook setup |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Deploy notes |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Extended deployment |
| [docs/FUMOCA_BIBLE.md](docs/FUMOCA_BIBLE.md) | Full product / technical bible |
| [docs/FUMOC_V2_SPEC.md](docs/FUMOC_V2_SPEC.md) | Format / V2 notes |
| [docs/VISION.md](docs/VISION.md) | Long-term platform vision (parked) |

---

## License / contribution

Personal / project repo. Fork and adapt as needed.
