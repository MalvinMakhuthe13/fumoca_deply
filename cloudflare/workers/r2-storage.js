/**
 * FUMOCA R2 Storage Worker
 * ════════════════════════════════════════════════════════════
 * Handles all file storage operations via Cloudflare R2.
 * Replaces Supabase Storage for all splat/video/thumbnail files.
 *
 * Routes:
 *   POST   /upload/presign     → Returns a presigned PUT URL for direct browser upload
 *   PUT    /upload/:key        → Direct upload (fallback, small files)
 *   GET    /file/:key          → Serve file (with CDN caching)
 *   DELETE /file/:key          → Delete file (admin/owner only)
 *   GET    /health             → Health check
 *
 * Env vars required (set in Cloudflare dashboard → Workers → Settings → Variables):
 *   R2_BUCKET         → R2 bucket binding (set as R2 binding, not plaintext)
 *   FUMOCA_API_SECRET → shared secret for SERVER-TO-SERVER calls only (kaggle
 *                       worker, backend API) — must NEVER be sent from a browser.
 *                       If you previously shipped this in config.js, rotate it now:
 *                       `wrangler secret put FUMOCA_API_SECRET` with a fresh value.
 *   SUPABASE_URL      → e.g. https://xxxx.supabase.co (used to verify user sessions)
 *   SUPABASE_ANON_KEY → Supabase anon/publishable key (safe to be public, same
 *                       value already in your frontend config.js)
 *   ALLOWED_ORIGIN    → e.g. https://fumoca.co.za  (CORS)
 *   PUBLIC_BASE_URL   → e.g. https://cdn.fumoca.co.za (served file base)
 * ════════════════════════════════════════════════════════════
 */

const CACHE_TTL = 60 * 60 * 24 * 7; // 7 days for splat/ply files
const THUMB_TTL = 60 * 60 * 24;      // 1 day for thumbnails

// ── Bucket → path prefix mapping (mirrors old Supabase buckets) ──────────────
const BUCKET_MAP = {
  'splat-videos':   'videos',
  'splat-files':    'splats',
  'splats':         'splats',
  'preview-videos': 'previews',
  'thumbnails':     'thumbs',
  'avatars':        'avatars',
};

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
 *      — this is how the browser authenticates now. Verified by asking Supabase
 *      itself whether the token is valid, not by trusting anything the client claims.
 *   2. The FUMOCA_API_SECRET header — reserved for genuine server-to-server calls
 *      (the Kaggle reconstruction worker, the backend API). This secret must never
 *      be sent by browser-side code; if it's absent from env, that path is simply
 *      unavailable rather than silently open.
 * Returns the authenticated user object (or a synthetic server-principal), or null.
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
    if (!resp.ok) return null;
    const user = await resp.json();
    return user?.id ? { id: user.id, kind: 'user' } : null;
  } catch (e) {
    console.error('[R2 auth check failed]', e);
    return null;
  }
}

// ── Build R2 key from bucket + user path ─────────────────────────────────────
function buildKey(bucket, userPath) {
  const prefix = BUCKET_MAP[bucket] || bucket;
  // Sanitise: strip leading slashes, prevent traversal
  const safe = userPath.replace(/\.\./g, '').replace(/^\/+/, '');
  return `${prefix}/${safe}`;
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

    // ── GET /health ───────────────────────────────────────────────────────────
    if (request.method === 'GET' && path === '/health') {
      return json({ ok: true, service: 'fumoca-r2', ts: Date.now() }, 200, cors);
    }

    // ── POST /upload/presign ──────────────────────────────────────────────────
    // Body: { bucket, path, contentType, userId }
    // Returns: { uploadUrl, fileKey, publicUrl }
    if (request.method === 'POST' && path === '/upload/presign') {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      let body;
      try { body = await request.json(); }
      catch { return json({ error: 'Invalid JSON body' }, 400, cors); }

      const { bucket = 'splat-files', path: userPath, contentType = 'application/octet-stream' } = body;
      if (!userPath) return json({ error: 'Missing path' }, 400, cors);

      const fileKey = buildKey(bucket, userPath);

      // R2 presigned URL — valid for 1 hour
      const presigned = await env.R2_BUCKET.createMultipartUpload
        ? await generatePresignedPut(env.R2_BUCKET, fileKey, contentType, env)
        : null;

      // Fallback: return a direct-upload URL pointing back to this worker
      const uploadUrl = presigned || `${env.PUBLIC_BASE_URL || url.origin}/upload/${encodeURIComponent(fileKey)}`;
      const publicUrl = `${env.PUBLIC_BASE_URL || url.origin}/file/${encodeURIComponent(fileKey)}`;

      return json({ uploadUrl, fileKey, publicUrl }, 200, cors);
    }

    // ── PUT /upload/:key — Direct upload (browser sends file body) ────────────
    if (request.method === 'PUT' && path.startsWith('/upload/')) {
      const principal = await authorize(request, env);
      if (!principal) {
        return json({ error: 'Unauthorized — sign in and try again' }, 401, cors);
      }

      const fileKey = decodeURIComponent(path.slice('/upload/'.length));
      if (!fileKey) return json({ error: 'Missing key' }, 400, cors);

      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';
      const body = request.body;

      await env.R2_BUCKET.put(fileKey, body, {
        httpMetadata: { contentType },
        customMetadata: { uploadedAt: new Date().toISOString() },
      });

      const publicUrl = `${env.PUBLIC_BASE_URL || url.origin}/file/${encodeURIComponent(fileKey)}`;
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

      const obj = await env.R2_BUCKET.get(fileKey);
      if (!obj) return json({ error: 'Not found' }, 404, cors);

      const isThumb = fileKey.startsWith('thumbs/') || fileKey.startsWith('avatars/');
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
      // needs a query against your `splats` table (matching this fileKey's public URL
      // to a row's user_id) — didn't want to guess at exact column names/RLS setup
      // without checking your live schema first. Worth doing before this is trusted
      // with real user data at scale.

      const fileKey = decodeURIComponent(path.slice('/file/'.length));
      await env.R2_BUCKET.delete(fileKey);
      return json({ ok: true, deleted: fileKey }, 200, cors);
    }

    return json({ error: 'Not found' }, 404, cors);
  },
};

// ── Presigned PUT helper (uses R2 signed URL API) ────────────────────────────
async function generatePresignedPut(bucket, key, contentType, env) {
  try {
    // Cloudflare R2 presigned URLs via the S3-compat API
    // Requires ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY env vars
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
