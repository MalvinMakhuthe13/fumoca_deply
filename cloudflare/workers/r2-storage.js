import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * FUMOCA R2 Storage Worker
 * ════════════════════════════════════════════════════════════
 * Handles all file storage operations via Cloudflare R2.
 *
 * Routes:
 *   POST   /upload/presign        → Returns an upload URL (presigned or worker-fallback)
 *   PUT    /upload/:key           → Direct upload (fallback, small files)
 *                                   optional ?bucket=<name>, defaults to nif-files
 *   GET    /file/:key             → Serve file (with CDN caching)
 *                                   optional ?bucket=<name>, defaults to nif-files
 *   DELETE /file/:key             → Delete file (owner or trusted server only)
 *                                   optional ?bucket=<name>, defaults to nif-files
 *   GET    /health                → Health check
 *
 * Env vars required (set in Cloudflare dashboard → Workers → Settings → Variables):
 *   NIF_FILES, NIF_VIDEOS, PREVIEW_VIDEOS, THUMBNAILS, AVATARS
 *                     → R2 bucket bindings (one per bucket name below)
 *   FUMOCA_API_SECRET → shared secret for SERVER-TO-SERVER calls only (kaggle
 *                       worker, backend API) — must NEVER be sent from a browser.
 *   SUPABASE_URL      → e.g. https://xxxx.supabase.co (used to verify user sessions)
 *   SUPABASE_ANON_KEY → Supabase anon/publishable key (safe to be public, same
 *                       value already in your frontend config.js)
 *   ALLOWED_ORIGIN    → e.g. https://fumoca.co.za  (CORS)
 *   PUBLIC_BASE_URL   → e.g. https://cdn.fumoca.co.za (served file base)
 *
 *   Required for real presigned PUT URLs (S3-compatible API):
 *   ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   (R2_BUCKET_NAME is NOT needed — the bucket is passed per-request)
 * ════════════════════════════════════════════════════════════
 */

const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days for splat/ply files
const THUMB_TTL = 60 * 60 * 24;     // 1 day for thumbnails
const PRESIGN_EXPIRY = 3600;        // 1 hour
const MAX_KEY_LENGTH = 500;

// Max direct-upload body size, in bytes (default 200MB). Only enforced on the
// worker-proxied PUT /upload/:key path — presigned uploads go straight to R2
// and aren't covered by this check.
const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// MIME whitelist per bucket. Starting point only — adjust to match what each
// bucket actually needs to accept.
const ALLOWED_MIME_TYPES = {
  'nif-videos': ['video/mp4', 'video/webm', 'video/quicktime', 'application/zip'],
  'preview-videos': ['video/mp4', 'video/webm'],
  'nif-files': ['application/octet-stream','application/x-ply','model/x-ply','application/ply','model/ply','model/gltf-binary','application/zip'],
  'thumbnails': ['image/jpeg', 'image/png', 'image/webp'],
  'avatars': ['image/jpeg', 'image/png', 'image/webp'],
};

// ── CORS ─────────────────────────────────────────────────────────────────────
function corsHeaders(origin, allowedOrigin) {
  const ok = !allowedOrigin || origin === allowedOrigin || allowedOrigin === '*';
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Fumoca-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/**
 * Authorize a write request one of two ways:
 *   1. A real, currently-valid Supabase user session (Authorization: Bearer <token>)
 *      — verified by asking Supabase itself whether the token is valid, not by
 *      trusting anything the client claims.
 *   2. The FUMOCA_API_SECRET header — reserved for genuine server-to-server calls
 *      (the Kaggle reconstruction worker, the backend API). This secret must never
 *      be sent by browser-side code; if it's absent from env, that path is simply
 *      unavailable rather than silently open.
 *
 * Returns the authenticated user object (or a synthetic server-principal), or null.
 * IMPORTANT: this function must only ever return a principal object or null —
 * never a Response — or callers' `if (!principal)` checks silently stop working.
 */
async function authorize(request, env) {
  const serverSecret = request.headers.get('X-Fumoca-Secret');
  if (serverSecret && env.FUMOCA_API_SECRET && serverSecret === env.FUMOCA_API_SECRET) {
    return { id: 'server', kind: 'server-to-server' };
  }

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });

    if (!resp.ok) {
      console.error('[R2 auth] Supabase rejected token', resp.status);
      return null;
    }

    const user = await resp.json();
    return user?.id ? { id: user.id, kind: 'user' } : null;
  } catch (e) {
    console.error('[R2 auth] check failed', e);
    return null;
  }
}

// A valid session alone does not grant ownership of arbitrary R2 keys.
// Most user uploads live under <auth-user-id>/; Studio edits use
// <nif_files-record-id>/edited_<timestamp>.<ext>, so those require a row-owner
// lookup. Fail closed if the database cannot confirm ownership.
async function userOwnsFileKey(request, env, principal, bucketName, fileKey) {
  if (principal?.kind === 'server-to-server') return true;
  if (!principal?.id || principal.kind !== 'user') return false;
  if (fileKey.startsWith(`${principal.id}/`)) return true;
  if (!['nif-files', 'nif-videos', 'thumbnails'].includes(bucketName)) return false;

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '');
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;

  // Match the exact object key against the caller's own NIF row or its known
  // source/thumbnail metadata. This supports cleanup without granting access
  // to arbitrary keys merely because a caller knows a record ID.
  const encodedKey = fileKey.replace(/,/g, '\\,');
  const query = new URLSearchParams({
    select: 'id,r2_key,meta',
    user_id: `eq.${principal.id}`,
    limit: '1',
    or: `(r2_key.eq.${encodedKey},meta->>source_r2_key.eq.${encodedKey},meta->source_capture->>r2_key.eq.${encodedKey},meta->>thumbnail_r2_key.eq.${encodedKey},meta->>capture_thumbnail_r2_key.eq.${encodedKey})`,
  });
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nif_files?${query}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!response.ok) {
      console.error('[R2 delete] owner lookup failed', response.status);
      return false;
    }
    const rows = await response.json();
    return Array.isArray(rows) && rows.some(row => {
      if (row?.user_id && row.user_id !== principal.id) return false;
      const meta = row?.meta || {};
      const knownKeys = [
        row?.r2_key,
        meta.source_r2_key,
        meta.source_capture?.r2_key,
        meta.thumbnail_r2_key,
        meta.capture_thumbnail_r2_key,
      ];
      return knownKeys.includes(fileKey);
    });
  } catch (error) {
    console.error('[R2 delete] owner lookup errored', error?.message || String(error));
    return false;
  }
}

// Authorize writes separately from deletes: a new Studio derivative does not yet
// equal nif_files.r2_key, but its record must still belong to the caller.
async function userMayWriteFileKey(request, env, principal, bucketName, fileKey) {
  if (principal?.kind === 'server-to-server') return true;
  if (!principal?.id || principal.kind !== 'user') return false;
  if (fileKey.startsWith(`${principal.id}/`)) return true;
  if (bucketName !== 'nif-files') return false;

  const slash = fileKey.indexOf('/');
  if (slash <= 0) return false;
  const recordId = fileKey.slice(0, slash);
  const remainder = fileKey.slice(slash + 1);
  if (!/^edited_[A-Za-z0-9_-]+\.(?:nif|ply|splat|glb)$/i.test(remainder)) return false;

  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/, '');
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  const query = new URLSearchParams({
    select: 'id',
    id: `eq.${recordId}`,
    user_id: `eq.${principal.id}`,
    limit: '1',
  });
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nif_files?${query}`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!response.ok) {
      console.error('[R2 write] owner lookup failed', response.status);
      return false;
    }
    const rows = await response.json();
    return Array.isArray(rows) && rows.some(row => row?.id === recordId);
  } catch (error) {
    console.error('[R2 write] owner lookup errored', error?.message || String(error));
    return false;
  }
}

// Read access is deliberately stricter than URL visibility flags in the browser.
// Public NIF output is public only when its owning nif_files row says is_public=true.
// Raw capture videos and previews are private unless an explicit association policy
// is added; a known object key or ?public=1 flag is not an authorization grant.
async function authorizeFileRead(request, env, principal, bucketName, fileKey) {
  if (!['nif-files', 'nif-videos', 'preview-videos', 'thumbnails', 'avatars'].includes(bucketName)) {
    return { allowed: false, isPublic: false, reason: 'unknown-bucket' };
  }

  // Profile avatars are intentionally public for existing profile/feed compatibility.
  if (bucketName === 'avatars') return { allowed: true, isPublic: true, reason: 'public-avatar' };

  // User-scoped object keys remain readable by their owner, never by another user.
  if (principal?.kind === 'user' && principal.id && fileKey.startsWith(`${principal.id}/`)) {
    return { allowed: true, isPublic: false, reason: 'owner-key' };
  }
  if (principal?.kind === 'server-to-server') {
    return { allowed: true, isPublic: false, reason: 'trusted-server' };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return { allowed: false, isPublic: false, reason: 'lookup-not-configured' };
  }

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const headers = { apikey: env.SUPABASE_ANON_KEY };
  if (token && principal?.kind === 'user') headers.Authorization = `Bearer ${token}`;
  const encodedKey = fileKey.replace(/,/g, '\\,');
  const query = new URLSearchParams({
    select: 'id,user_id,r2_key,is_public,meta',
    limit: '20',
    or: `(r2_key.eq.${encodedKey},meta->>source_r2_key.eq.${encodedKey},meta->source_capture->>r2_key.eq.${encodedKey},meta->>thumbnail_r2_key.eq.${encodedKey},meta->>capture_thumbnail_r2_key.eq.${encodedKey})`,
  });
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/nif_files?${query}`, { headers });
    if (!response.ok) {
      console.error('[R2 read] NIF access lookup failed', response.status);
      return { allowed: false, isPublic: false, reason: 'lookup-failed' };
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) return { allowed: false, isPublic: false, reason: 'invalid-lookup' };

    for (const row of rows) {
      const meta = row?.meta || {};
      const isNifOutput = bucketName === 'nif-files' && row?.r2_key === fileKey;
      const isThumbnail = bucketName === 'thumbnails' &&
        [meta.thumbnail_r2_key, meta.capture_thumbnail_r2_key].includes(fileKey);
      const isSource = bucketName === 'nif-videos' &&
        [meta.source_r2_key, meta.source_capture?.r2_key].includes(fileKey);
      const owner = !!(principal?.kind === 'user' && principal.id && row?.user_id === principal.id);
      if (isNifOutput && row.is_public === true) {
        return { allowed: true, isPublic: true, reason: 'published-nif' };
      }
      if (owner && (isNifOutput || isThumbnail || isSource)) {
        return { allowed: true, isPublic: false, reason: 'owner-associated-file' };
      }
      if (isThumbnail && row.is_public === true) {
        return { allowed: true, isPublic: true, reason: 'published-nif-thumbnail' };
      }
    }

    // Raw source keys may live on reconstruction_jobs rather than nif_files metadata.
    if (bucketName === 'nif-videos' && principal?.kind === 'user' && principal.id) {
      const jobsQuery = new URLSearchParams({
        select: 'id,user_id,raw_r2_key',
        user_id: `eq.${principal.id}`,
        raw_r2_key: `eq.${fileKey}`,
        limit: '1',
      });
      const jobsResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/reconstruction_jobs?${jobsQuery}`, { headers });
      if (jobsResponse.ok) {
        const jobs = await jobsResponse.json();
        if (Array.isArray(jobs) && jobs.some(job => job?.user_id === principal.id && job?.raw_r2_key === fileKey)) {
          return { allowed: true, isPublic: false, reason: 'owner-source-job' };
        }
      } else {
        console.error('[R2 read] source job lookup failed', jobsResponse.status);
      }
    }

    return { allowed: false, isPublic: false, reason: 'not-published-or-not-owner' };
  } catch (error) {
    console.error('[R2 read] access lookup errored', error?.message || String(error));
    return { allowed: false, isPublic: false, reason: 'lookup-error' };
  }
}

// ── Key sanitisation ────────────────────────────────────────────────────────
// Strips traversal attempts, backslashes, and collapses duplicate slashes.
// Also enforces a sane max length so absurdly long paths can't be used to
// abuse R2 key limits or your CDN/cache layer.
function sanitiseKey(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.length > MAX_KEY_LENGTH || rawPath.includes('\0')) {
    return '';
  }
  const slashNormalised = rawPath.replace(/\\/g, '/');
  const segments = slashNormalised.split('/');
  // Reject traversal segments instead of silently rewriting them to a different key.
  if (segments.some(segment => segment === '.' || segment === '..')) return '';
  return slashNormalised.replace(/\/+/g, '/').replace(/^\/+/, '');
}

function isAllowedMimeType(bucketName, contentType) {
  const allowed = ALLOWED_MIME_TYPES[bucketName];

  if (!allowed) return true;

  const normalised = String(contentType || '')
    .split(';', 1)[0]
    .trim()
    .toLowerCase();

  return allowed.some(
    (type) => type.toLowerCase() === normalised
  );
}

// ── Bucket resolver ──────────────────────────────────────────────────────────
// Maps a public bucket name to its R2 binding (used for actual reads/writes).
function getBucket(bucketName, env) {
  const buckets = {
    'nif-files': env.NIF_FILES,
    'nif-videos': env.NIF_VIDEOS,
    'preview-videos': env.PREVIEW_VIDEOS,
    'thumbnails': env.THUMBNAILS,
    'avatars': env.AVATARS,
  };
  return buckets[bucketName] ?? null;
}

// ── Presigned PUT URL (S3-compatible API via AWS SDK) ────────────────────────
// Takes the public bucket NAME (e.g. 'nif-videos'), not the R2 binding object —
// the AWS SDK talks to R2's S3-compatible endpoint, which addresses buckets by
// name, not by Worker binding.
async function generatePresignedPut(bucketName, key, contentType, env) {
  if (!env.ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    console.warn('[R2 presign] S3 credentials are not configured');
    return null;
  }

  try {
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    });

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });

    return await getSignedUrl(client, command, { expiresIn: PRESIGN_EXPIRY });
  } catch (error) {
    console.error('[R2 presign] failed', error);
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const path = url.pathname;
    const bucketParam = url.searchParams.get('bucket') || 'nif-files';

    // ── GET /health ────────────────────────────────────────────────────────
    if (request.method === 'GET' && path === '/health') {
      const buckets = {
        'nif-files': !!env.NIF_FILES,
        'nif-videos': !!env.NIF_VIDEOS,
        'preview-videos': !!env.PREVIEW_VIDEOS,
        'thumbnails': !!env.THUMBNAILS,
        'avatars': !!env.AVATARS,
      };
      const presignConfigured = !!(env.ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
      const supabaseConfigured = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
      const allBucketsBound = Object.values(buckets).every(Boolean);

      return json({
        ok: allBucketsBound && supabaseConfigured,
        service: 'fumoca-r2',
        ts: Date.now(),
        buckets,
        presignConfigured,
        supabaseConfigured,
      }, 200, cors);
    }

    // ── POST /upload/presign ──────────────────────────────────────────────
    // Body: { bucket, path, contentType }
    // Returns: { uploadUrl, fileKey, publicUrl, mode }
    if (request.method === 'POST' && path === '/upload/presign') {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400, cors);
      }

      const {
        bucket = 'nif-files',
        path: userPath,
        contentType = 'application/octet-stream',
      } = body;

      if (!userPath) return json({ error: 'Missing path' }, 400, cors);

      const r2Bucket = getBucket(bucket, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucket}` }, 400, cors);
      }

      if (!isAllowedMimeType(bucket, contentType)) {
        return json({ error: `Content type not allowed for bucket ${bucket}: ${contentType}` }, 400, cors);
      }

      const fileKey = sanitiseKey(userPath);
      if (!fileKey) return json({ error: 'Invalid path' }, 400, cors);
      const mayWrite = await userMayWriteFileKey(request, env, principal, bucket, fileKey);
      if (!mayWrite) return json({ error: 'Forbidden — you may not write this file key' }, 403, cors);

      // Pass the bucket NAME (not the binding) — the S3-compat API needs a name.
      const presigned = await generatePresignedPut(bucket, fileKey, contentType, env);

      const uploadUrl =
        presigned ||
        `${env.PUBLIC_BASE_URL || url.origin}/upload/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucket)}`;
      const publicUrl = `${env.PUBLIC_BASE_URL || url.origin}/file/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucket)}`;

      return json({
        uploadUrl,
        fileKey,
        publicUrl,
        mode: presigned ? 'r2-presigned' : 'worker-proxy',
      }, 200, cors);
    }

    // ── PUT /upload/:key — Direct upload (browser sends file body) ─────────

    // ── Multipart upload API — large browser uploads ────────────────────────────────

    if (request.method === 'POST' && path === '/upload/multipart/create') {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400, cors);
      }

      const rawPath = body?.path;
      const contentType = body?.contentType || 'application/octet-stream';

      if (!rawPath) {
        return json({ error: 'Missing path' }, 400, cors);
      }

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      if (!isAllowedMimeType(bucketParam, contentType)) {
        return json({
          error: `Content type not allowed for bucket ${bucketParam}: ${contentType}`
        }, 400, cors);
      }

      const fileKey = sanitiseKey(rawPath);
      if (!fileKey) {
        return json({ error: 'Invalid path' }, 400, cors);
      }
      const mayWrite = await userMayWriteFileKey(request, env, principal, bucketParam, fileKey);
      if (!mayWrite) return json({ error: 'Forbidden — you may not write this file key' }, 403, cors);

      try {
        const upload = await r2Bucket.createMultipartUpload(fileKey, {
          httpMetadata: { contentType },
          customMetadata: {
            uploadedAt: new Date().toISOString(),
          },
        });

        return json({
          ok: true,
          uploadId: upload.uploadId,
          fileKey,
          publicUrl: `${env.PUBLIC_BASE_URL || url.origin}/file/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucketParam)}`,
        }, 200, cors);
      } catch (err) {
        console.error('[R2 multipart create] failed', err);
        return json({
          error: `Could not create multipart upload: ${err?.message || err}`
        }, 500, cors);
      }
    }

    if (request.method === 'PUT' && path === '/upload/multipart/part') {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      if (!request.body) {
        return json({ error: 'Empty upload part body' }, 400, cors);
      }

      const uploadId = url.searchParams.get('uploadId');
      const fileKeyParam = url.searchParams.get('key');
      const partNumber = Number(url.searchParams.get('partNumber'));

      if (!uploadId) {
        return json({ error: 'Missing uploadId' }, 400, cors);
      }

      if (!fileKeyParam) {
        return json({ error: 'Missing key' }, 400, cors);
      }

      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
        return json({ error: 'Invalid partNumber' }, 400, cors);
      }

      const safeFileKey = sanitiseKey(decodeURIComponent(fileKeyParam));
      if (!safeFileKey) {
        return json({ error: 'Invalid key' }, 400, cors);
      }
      const mayWrite = await userMayWriteFileKey(request, env, principal, bucketParam, safeFileKey);
      if (!mayWrite) return json({ error: 'Forbidden — you may not write this file key' }, 403, cors);

      try {
        const multipart = r2Bucket.resumeMultipartUpload(safeFileKey, uploadId);
        const uploadedPart = await multipart.uploadPart(partNumber, request.body);

        return json({
          ok: true,
          partNumber,
          etag: uploadedPart.etag,
        }, 200, cors);
      } catch (err) {
        console.error('[R2 multipart part] failed', {
          fileKey: safeFileKey,
          partNumber,
          error: err?.message || String(err),
        });

        return json({
          error: `Could not upload part ${partNumber}: ${err?.message || err}`
        }, 500, cors);
      }
    }

    if (request.method === 'POST' && path === '/upload/multipart/complete') {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400, cors);
      }

      const uploadId = body?.uploadId;
      const rawKey = body?.key;
      const parts = body?.parts;

      if (!uploadId) {
        return json({ error: 'Missing uploadId' }, 400, cors);
      }

      if (!rawKey) {
        return json({ error: 'Missing key' }, 400, cors);
      }

      if (!Array.isArray(parts) || parts.length === 0) {
        return json({ error: 'Missing multipart parts' }, 400, cors);
      }

      const fileKey = sanitiseKey(rawKey);
      if (!fileKey) {
        return json({ error: 'Invalid key' }, 400, cors);
      }
      const mayWrite = await userMayWriteFileKey(request, env, principal, bucketParam, fileKey);
      if (!mayWrite) return json({ error: 'Forbidden — you may not write this file key' }, 403, cors);

      const normalisedParts = parts.map((part) => ({
        partNumber: Number(part?.partNumber),
        etag: String(part?.etag || ''),
      }));

      if (normalisedParts.some(
        (part) =>
          !Number.isInteger(part.partNumber) ||
          part.partNumber < 1 ||
          part.partNumber > 10000 ||
          !part.etag
      )) {
        return json({ error: 'Invalid multipart part list' }, 400, cors);
      }

      normalisedParts.sort((a, b) => a.partNumber - b.partNumber);

      for (let i = 0; i < normalisedParts.length; i++) {
        if (normalisedParts[i].partNumber !== i + 1) {
          return json({
            error: 'Multipart parts must be consecutive starting at 1'
          }, 400, cors);
        }
      }

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      try {
        const multipart = r2Bucket.resumeMultipartUpload(fileKey, uploadId);
        await multipart.complete(normalisedParts);

        const publicUrl =
          `${env.PUBLIC_BASE_URL || url.origin}/file/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucketParam)}`;

        return json({
          ok: true,
          fileKey,
          publicUrl,
        }, 200, cors);
      } catch (err) {
        console.error('[R2 multipart complete] failed', err);

        return json({
          error: `Could not complete multipart upload: ${err?.message || err}`
        }, 500, cors);
      }
    }

    if (request.method === 'POST' && path === '/upload/multipart/abort') {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Invalid JSON body' }, 400, cors);
      }

      const uploadId = body?.uploadId;
      const rawKey = body?.key;

      if (!uploadId) {
        return json({ error: 'Missing uploadId' }, 400, cors);
      }

      if (!rawKey) {
        return json({ error: 'Missing key' }, 400, cors);
      }

      const fileKey = sanitiseKey(rawKey);
      if (!fileKey) {
        return json({ error: 'Invalid key' }, 400, cors);
      }
      const mayWrite = await userMayWriteFileKey(request, env, principal, bucketParam, fileKey);
      if (!mayWrite) return json({ error: 'Forbidden — you may not write this file key' }, 403, cors);

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      try {
        const multipart = r2Bucket.resumeMultipartUpload(fileKey, uploadId);
        await multipart.abort();

        return json({ ok: true }, 200, cors);
      } catch (err) {
        console.error('[R2 multipart abort] failed', err);

        return json({
          error: `Could not abort multipart upload: ${err?.message || err}`
        }, 500, cors);
      }
    }

    if (request.method === 'PUT' && path.startsWith('/upload/')) {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      const fileKey = sanitiseKey(decodeURIComponent(path.slice('/upload/'.length)));
      if (!fileKey) return json({ error: 'Missing key' }, 400, cors);
      const mayWrite = await userMayWriteFileKey(request, env, principal, bucketParam, fileKey);
      if (!mayWrite) return json({ error: 'Forbidden — you may not write this file key' }, 403, cors);

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
      if (!isAllowedMimeType(bucketParam, contentType)) {
        return json({ error: `Content type not allowed for bucket ${bucketParam}: ${contentType}` }, 400, cors);
      }

      if (!request.body) {
        return json({ error: 'Empty upload body' }, 400, cors);
      }

      const contentLengthHeader = request.headers.get('Content-Length');
      if (!contentLengthHeader) {
        return json({ error: 'Content-Length header is required' }, 411, cors);
      }
      const contentLength = Number(contentLengthHeader);
      if (!contentLength) {
        return json({ error: 'Empty upload body' }, 400, cors);
      }
      const maxUploadBytes = Number(env.MAX_UPLOAD_BYTES) || DEFAULT_MAX_UPLOAD_BYTES;
      if (contentLength > maxUploadBytes) {
        return json({ error: `File too large (max ${maxUploadBytes} bytes)` }, 413, cors);
      }

      await r2Bucket.put(fileKey, request.body, {
        httpMetadata: { contentType },
        customMetadata: { uploadedAt: new Date().toISOString() },
      });

      const publicUrl = `${env.PUBLIC_BASE_URL || url.origin}/file/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucketParam)}`;
      return json({ ok: true, fileKey, publicUrl }, 200, cors);
    }

    // ── GET /file/:key — Serve file with caching ───────────────────────────
    if (request.method === 'GET' && path.startsWith('/file/')) {
      let rawKey;
      try {
        rawKey = decodeURIComponent(path.slice('/file/'.length));
      } catch {
        return json({ error: 'Malformed file key' }, 400, cors);
      }
      const fileKey = sanitiseKey(rawKey);
      if (!fileKey) return json({ error: 'Missing key' }, 400, cors);

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      // Authorize before touching the shared cache. Private/owner responses must
      // never be read from or written to caches.default.
      let principal = await authorize(request, env);
      const access = await authorizeFileRead(request, env, principal, bucketParam, fileKey);
      if (!access.allowed) {
        return json({ error: 'Not found' }, 404, {
          ...cors,
          'Cache-Control': 'no-store',
        });
      }

      const cache = caches.default;
      const cacheKey = new Request(request.url, { method: 'GET' });
      if (access.isPublic) {
        const cached = await cache.match(cacheKey);
        if (cached) return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: { ...Object.fromEntries(cached.headers), ...cors, 'Cache-Control': cached.headers.get('Cache-Control') || 'public, max-age=60' },
        });
      }

      const obj = await r2Bucket.get(fileKey);
      if (!obj) return json({ error: 'Not found' }, 404, { ...cors, 'Cache-Control': 'no-store' });

      const isThumb = bucketParam === 'thumbnails' || bucketParam === 'avatars';
      const ttl = isThumb ? THUMB_TTL : CACHE_TTL;
      const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
      const responseHeaders = {
        'Content-Type': contentType,
        'ETag': obj.etag,
        'Accept-Ranges': 'bytes',
        ...cors,
        'Cache-Control': access.isPublic ? `public, max-age=${ttl}` : 'private, no-store',
      };
      const response = new Response(obj.body, { headers: responseHeaders });

      if (access.isPublic) ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // ── DELETE /file/:key ────────────────────────────────────────────────
    if (request.method === 'DELETE' && path.startsWith('/file/')) {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }
      const fileKey = sanitiseKey(decodeURIComponent(path.slice('/file/'.length)));
      if (!fileKey) return json({ error: 'Missing key' }, 400, cors);

      const ownsKey = await userOwnsFileKey(request, env, principal, bucketParam, fileKey);
      if (!ownsKey) {
        return json({ error: 'Forbidden — you do not own this file key' }, 403, cors);
      }

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      await r2Bucket.delete(fileKey);
      return json({ ok: true, deleted: fileKey }, 200, cors);
    }

    return json({ error: 'Not found' }, 404, cors);
  },
};
