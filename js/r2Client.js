/**
 * FUMOCA R2 Storage Client  v1.0
 * ════════════════════════════════════════════════════════════
 * Drop-in replacement for supabase.storage calls.
 * Talks to the Cloudflare R2 Worker (r2-storage.js).
 *
 * Usage (identical API surface to supabase.storage):
 *   import { r2 } from './r2Client.js';
 *
 *   // Upload
 *   const { publicUrl, error } = await r2.from('splat-files').upload(path, blob);
 *
 *   // Get public URL (sync, no network call needed)
 *   const url = r2.from('splat-files').getPublicUrl(path);
 *
 *   // Delete
 *   await r2.from('splat-files').remove([path]);
 * ════════════════════════════════════════════════════════════
 */

import { supabase } from './supabaseClient.js';

// ── Config ────────────────────────────────────────────────────────────────────
function getConfig() {
  const cfg = window.FUMOCA_CONFIG || {};
  return {
    workerUrl: cfg.r2WorkerUrl || 'https://cdn.fumoca.co.za',
  };
}

// Real, short-lived Supabase session token — replaces the static shared secret
// that used to be shipped in config.js (readable by anyone via view-source).
// The worker verifies this against Supabase itself, not against a static string.
async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Bucket proxy object ───────────────────────────────────────────────────────
class R2BucketProxy {
  constructor(bucketName) {
    this._bucket = bucketName;
  }

  /**
   * Upload a file to R2.
   * @param {string} path        Storage path (e.g. "userId/filename.splat")
   * @param {Blob|ArrayBuffer|ReadableStream} data
   * @param {object} opts        { contentType, upsert }
   * @returns {{ publicUrl, fileKey, error }}
   */
  async upload(path, data, opts = {}) {
    const { workerUrl } = getConfig();
    const contentType = opts.contentType
      || (data instanceof Blob ? data.type : null)
      || 'application/octet-stream';

    // Step 1 — get a presigned PUT URL from the worker
    let uploadUrl, fileKey, publicUrl;
    try {
      const presignRes = await fetch(`${workerUrl}/upload/presign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await authHeader()),
        },
        body: JSON.stringify({ bucket: this._bucket, path, contentType }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        return { publicUrl: null, fileKey: null, error: { message: err.error || 'Presign failed' } };
      }

      const presign = await presignRes.json();
      uploadUrl  = presign.uploadUrl;
      fileKey    = presign.fileKey;
      publicUrl  = presign.publicUrl;

    } catch (e) {
      return { publicUrl: null, fileKey: null, error: { message: `Presign network error: ${e.message}` } };
    }

    // Step 2 — PUT the file directly to R2 (via presigned URL or worker proxy)
    try {
      const body = data instanceof Blob ? data : (
        data instanceof ArrayBuffer ? new Blob([data], { type: contentType }) : data
      );

      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          // Only needed if going through the worker proxy (not a raw presigned URL)
          ...(uploadUrl.includes('/upload/') ? await authHeader() : {}),
        },
        body,
      });

      if (!putRes.ok) {
        const txt = await putRes.text().catch(() => '');
        return { publicUrl: null, fileKey, error: { message: `Upload failed (${putRes.status}): ${txt}` } };
      }

      return { publicUrl, fileKey, error: null };

    } catch (e) {
      return { publicUrl: null, fileKey, error: { message: `Upload network error: ${e.message}` } };
    }
  }

  /**
   * Get the public URL for a stored file (no network call).
   * Matches supabase.storage.from(bucket).getPublicUrl(path) API.
   * Returns { data: { publicUrl } } to match Supabase shape.
   */
  getPublicUrl(path) {
    const { workerUrl } = getConfig();
    const prefix = _bucketPrefix(this._bucket);
    const safe = path.replace(/^\/+/, '');
    const fileKey = `${prefix}/${safe}`;
    const publicUrl = `${workerUrl}/file/${encodeURIComponent(fileKey)}`;
    return { data: { publicUrl } };
  }

  /**
   * Delete one or more files.
   * @param {string[]} paths
   */
  async remove(paths) {
    const { workerUrl } = getConfig();
    const errors = [];
    const headers = await authHeader();

    await Promise.all(paths.map(async (p) => {
      const prefix = _bucketPrefix(this._bucket);
      const fileKey = `${prefix}/${p.replace(/^\/+/, '')}`;
      try {
        const res = await fetch(`${workerUrl}/file/${encodeURIComponent(fileKey)}`, {
          method: 'DELETE',
          headers,
        });
        if (!res.ok) errors.push({ path: p, error: `HTTP ${res.status}` });
      } catch (e) {
        errors.push({ path: p, error: e.message });
      }
    }));

    return { error: errors.length ? errors : null };
  }
}

// ── Bucket prefix map (mirrors worker) ────────────────────────────────────────
function _bucketPrefix(bucket) {
  const map = {
    'splat-videos':   'videos',
    'splat-files':    'splats',
    'splats':         'splats',
    'preview-videos': 'previews',
    'thumbnails':     'thumbs',
    'avatars':        'avatars',
  };
  return map[bucket] || bucket;
}

// ── Main r2 object (mirrors supabase.storage interface) ──────────────────────
export const r2 = {
  from(bucketName) {
    return new R2BucketProxy(bucketName);
  },

  /** Health check — useful during init to verify worker is reachable */
  async ping() {
    const { workerUrl } = getConfig();
    try {
      const res = await fetch(`${workerUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  },
};

export default r2;
