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
 *   DELETE /file/:key             → Delete file (any authenticated user — see NOTE below)
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
 *   Optional, only needed for real presigned PUT URLs (S3-compatible API):
 *   ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 * ════════════════════════════════════════════════════════════
 */

const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days for splat/ply files
const THUMB_TTL = 60 * 60 * 24;     // 1 day for thumbnails

// ── CORS headers ──────────────────────────────────────────────────────────────
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

  console.log({
    workerSupabaseUrl: env.SUPABASE_URL,
    hasAnonKey: !!env.SUPABASE_ANON_KEY,
    tokenLength: token?.length || 0
    });
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;

  try {
    const resp = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: env.SUPABASE_ANON_KEY,
      },
    });

    const text = await resp.text();

    console.log({
    status: resp.status,
    body: text
    });

    if (!resp.ok) {
      console.error('[R2 auth] Supabase rejected token', resp.status, text);
      return null;
    }

    const user = JSON.parse(text);
    return user?.id ? { id: user.id, kind: 'user' } : null;
  } catch (e) {
    console.error('[R2 auth check failed]', e);
    return null;
  }
}

// ── Key sanitisation ──────────────────────────────────────────────────────────
// Strips traversal attempts, backslashes, and collapses duplicate slashes.
// Also enforces a sane max length so absurdly long paths can't be used to
// abuse R2 key limits or your CDN/cache layer.
const MAX_KEY_LENGTH = 500;

function sanitiseKey(rawPath) {
  const cleaned = rawPath
    .replace(/\.\./g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '');
  return cleaned.slice(0, MAX_KEY_LENGTH);
}

// ── MIME whitelist per bucket ─────────────────────────────────────────────────
// Starting point only — adjust to match what each bucket actually needs to accept.
const ALLOWED_MIME_TYPES = {
  'nif-videos': ['video/mp4', 'video/webm', 'video/quicktime'],
  'preview-videos': ['video/mp4', 'video/webm'],
  'nif-files': ['application/octet-stream', 'application/x-ply', 'model/gltf-binary'],
  'thumbnails': ['image/jpeg', 'image/png', 'image/webp'],
  'avatars': ['image/jpeg', 'image/png', 'image/webp'],
};

function isAllowedMimeType(bucketName, contentType) {
  const allowed = ALLOWED_MIME_TYPES[bucketName];
  if (!allowed) return true; // unknown bucket name is caught elsewhere
  return allowed.includes(contentType);
}

// Max direct-upload body size, in bytes (default 200MB). Only enforced on the
// worker-proxied PUT /upload/:key path — presigned uploads go straight to R2
// and aren't covered by this check.
const DEFAULT_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// ── Bucket resolver ───────────────────────────────────────────────────────────
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

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const path = url.pathname;
    const bucketParam = url.searchParams.get('bucket') || 'nif-files';

    // ── GET /health ───────────────────────────────────────────────────────────
    if (request.method === 'GET' && path === '/health') {
      const buckets = {
        'nif-files': !!env.NIF_FILES,
        'nif-videos': !!env.NIF_VIDEOS,
        'preview-videos': !!env.PREVIEW_VIDEOS,
        'thumbnails': !!env.THUMBNAILS,
        'avatars': !!env.AVATARS,
      };
      const presignConfigured = !!(env.ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
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

    // ── POST /upload/presign ──────────────────────────────────────────────────
    // Body: { bucket, path, contentType }
    // Returns: { uploadUrl, fileKey, publicUrl }
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

      // R2 presigned URL — valid for 1 hour. generatePresignedPut() itself checks
      // whether S3-compat credentials are configured and falls back to null,
      // so we always call it and let it decide rather than guessing here.
      const presigned = await generatePresignedPut(r2Bucket, fileKey, contentType, env);

      const uploadUrl =
        presigned ||
        `${env.PUBLIC_BASE_URL || url.origin}/upload/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucket)}`;
      const publicUrl = `${env.PUBLIC_BASE_URL || url.origin}/file/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucket)}`;

      return json({ uploadUrl, fileKey, publicUrl }, 200, cors);
    }

    // ── PUT /upload/:key — Direct upload (browser sends file body) ────────────
    if (request.method === 'PUT' && path.startsWith('/upload/')) {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      const fileKey = sanitiseKey(decodeURIComponent(path.slice('/upload/'.length)));
      if (!fileKey) return json({ error: 'Missing key' }, 400, cors);

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

    // ── GET /file/:key — Serve file with caching ──────────────────────────────
    if (request.method === 'GET' && path.startsWith('/file/')) {
      const fileKey = decodeURIComponent(path.slice('/file/'.length));
      if (!fileKey) return json({ error: 'Missing key' }, 400, cors);

      // Try cache first
      const cache = caches.default;
      const cacheKey = new Request(request.url, { method: 'GET' });
      const cached = await cache.match(cacheKey);
      if (cached) return cached;

      const r2Bucket = getBucket(bucketParam, env);
      if (!r2Bucket) {
        return json({ error: `Unknown bucket: ${bucketParam}` }, 400, cors);
      }

      const obj = await r2Bucket.get(fileKey);
      if (!obj) return json({ error: 'Not found' }, 404, cors);

      const isThumb = fileKey.startsWith('thumbs/') || fileKey.startsWith('avatars/') || bucketParam === 'thumbnails' || bucketParam === 'avatars';
      const ttl = isThumb ? THUMB_TTL : CACHE_TTL;
      const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';

      const response = new Response(obj.body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': `public, max-age=${ttl}`,
          'ETag': obj.etag,
          'Accept-Ranges': 'bytes',
          ...cors,
        },
      });

      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // ── DELETE /file/:key ─────────────────────────────────────────────────────
    if (request.method === 'DELETE' && path.startsWith('/file/')) {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }
      // NOTE — remaining gap, not fixed here: this only confirms the caller is SOME
      // authenticated user, not that they own this specific file. Any signed-in user
      // can currently delete any file if they know/guess its key. Closing that fully
      // needs a lookup against your DB (matching this fileKey to a row's user_id)
      // before this is trusted with real user data at scale.

      const fileKey = sanitiseKey(decodeURIComponent(path.slice('/file/'.length)));
      if (!fileKey) return json({ error: 'Missing key' }, 400, cors);

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

// ── Presigned PUT helper (uses R2 signed URL API) ────────────────────────────
async function generatePresignedPut(bucket, key, contentType, env) {
  try {
    // Cloudflare R2 presigned URLs via the S3-compat API
    // Requires ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
    if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.ACCOUNT_ID || !env.R2_BUCKET_NAME) {
      return null; // fall back to direct worker upload
    }

    const expiry = 3600; // 1 hour
    const s3Endpoint = `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com`;
    const s3Url = `${s3Endpoint}/${env.R2_BUCKET_NAME}/${key}`;

    // AWS SigV4 presigned URL (R2 is S3-compatible)
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const dateShort = dateStr.slice(0, 8);

    const credential = `${env.R2_ACCESS_KEY_ID}/${dateShort}/auto/s3/aws4_request`;
    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': dateStr,
      'X-Amz-Expires': String(expiry),
      'X-Amz-SignedHeaders': 'host',
    });

    const host = new URL(s3Endpoint).host;
    const canonicalRequest = [
      'PUT',
      `/${env.R2_BUCKET_NAME}/${key}`,
      params.toString(),
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      dateStr,
      `${dateShort}/auto/s3/aws4_request`,
      await sha256hex(canonicalRequest),
    ].join('\n');

    const signingKey = await deriveSigningKey(env.R2_SECRET_ACCESS_KEY, dateShort);
    const signature = await hmacHex(signingKey, stringToSign);

    params.set('X-Amz-Signature', signature);
    return `${s3Url}?${params.toString()}`;
  } catch (e) {
    console.error('[R2 presign error]', e);
    return null;
  }
}

// ── Crypto helpers for SigV4 ─────────────────────────────────────────────────
async function sha256hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmac(key, msg) {
  const k = typeof key === 'string'
    ? await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    : await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
}
async function hmacHex(key, msg) {
  const buf = await hmac(key, msg);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function deriveSigningKey(secret, dateShort) {
  const k1 = await hmac(`AWS4${secret}`, dateShort);
  const k2 = await hmac(k1, 'auto');
  const k3 = await hmac(k2, 's3');
  return hmac(k3, 'aws4_request');
}