# FUMOCA R2 Worker — deployment and staging safety

## Important: do not deploy this QA branch to production yet

The current QA branch changes read authorization, signed private-read tickets, byte-range responses, upload/delete ownership, and teaser-video access. Repository CI is not proof that the live R2 bindings, Supabase RLS, cache behaviour or existing public links work. Do not run `wrangler deploy`, change production bindings, purge caches or apply the embed migration as part of this QA pass.

## Canonical configuration

- Worker source: `cloudflare/workers/r2-storage.js`.
- Canonical Wrangler configuration in this repository: root `wrangler.jsonc`.
- `cloudflare/wrangler.toml` and the older instructions in previous revisions are legacy; do not deploy using `cd cloudflare && wrangler deploy`.
- Frontend `config.js` currently points `r2WorkerUrl` at the `fumoca-r2` workers.dev host, and root `wrangler.jsonc` sets `PUBLIC_BASE_URL` to that same host. Keep these identical for a given environment.
- R2 bucket bindings expected by the current Worker: `nif-files`, `nif-videos`, `preview-videos`, `thumbnails`, and `avatars`.

## Required secrets / variables

Set these as Worker secrets/vars in the Cloudflare dashboard or the correct Wrangler environment; never commit secret values:

- `SUPABASE_URL` — the project's Supabase URL.
- `SUPABASE_ANON_KEY` — the public anon/publishable key used to validate user sessions and perform RLS-scoped lookups.
- `FUMOCA_API_SECRET` — strong random server-to-server secret only; never place it in `config.js`, HTML, or browser requests.
- `ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` — only if direct presigned R2 PUTs are enabled; use least-privilege credentials.
- `MAX_UPLOAD_BYTES` — optional direct Worker upload cap; default is 200 MiB.

## Before any deployment

1. Provision a genuinely separate staging Worker and staging R2 buckets. Do not point staging at the production bucket bindings in the root config.
2. Use a staging Supabase project with the current `nif_files` and `reconstruction_jobs` schema and RLS policies. Confirm that the authenticated caller can read only their own private rows and anonymous reads expose only intended public rows.
3. Apply the updated `supabase_migration_embeds.sql` to staging only after reviewing the SQL. It replaces blanket anonymous SELECT on `embeds` with owner-only reads and exact-token resolution via `resolve_embed_token(p_token)`.
4. Point a staging frontend config at the staging Worker. Keep `PUBLIC_BASE_URL` and `r2WorkerUrl` exactly aligned.
5. Run non-destructive tests for: published NIF GET; private NIF anonymous denial; owner private read ticket; cross-user denial; source-video privacy; published/private thumbnail and teaser visibility; byte ranges; cache behaviour after public-to-private transition; upload, delete and save/reopen.
6. Test direct R2 endpoints/custom domains separately from the Worker. A secure Worker does not protect a bucket or alternate domain that independently serves the same objects publicly.
7. Only after evidence is recorded should a separate release review decide whether to deploy. Production deployment and cache purges require explicit approval.

## Safe smoke-test expectations

- `GET /health` confirms configured bindings/secrets only; it does not prove authorization or object access is correct.
- A `Range: bytes=0-0` request for a published object should return HTTP 206 with a one-byte body and a correct `Content-Range` header.
- A private object requested anonymously should be denied even if a public-cache entry for that URL existed earlier.
- A private-read ticket is short-lived and scoped to a bucket/key. Do not copy it into public links or logs.
- A public teaser video is allowed only when its exact R2 key is stored in `nif_files.meta.teaser_video_r2_key` and the NIF row has `is_public = true`.

## Known unresolved release gates

- No live Worker/R2/Supabase staging probe has been run from this QA pass.
- Direct R2/custom-domain exposure and cache invalidation are not verified.
- Browser E2E for Studio select/transform/undo/redo/save/reopen remains outstanding.
- Higher-order Gaussian PLY SH preservation and PLY layer-manifest round-trip need a fidelity decision and evidence.
- A calibrated GPU reconstruction and reference-measured dimensions have not been validated.
- `convert.html` still uses the legacy Supabase Storage `splat-files` bucket for `.fumoc` sharing; verify that separate legacy path before claiming it is covered by the R2 Worker policy.

Until these gates are closed, keep PR #10 draft and do not call FUMOCA production-ready.