/**
 * FUMOCA R2 browser client
 * ════════════════════════════════════════════════════════════
 * This is the frontend counterpart to cloudflare/workers/r2-storage.js.
 * It talks to that Worker's HTTP API and exposes a small Supabase-storage-
 * shaped interface so the rest of the app (upload-page.js, feed.js, viewer.js,
 * profile.js, edit-engine.js, etc.) can call:
 *
 *   const { publicUrl, fileKey, error } = await r2.from('nif-videos')
 *     .upload(path, fileOrBlob, { contentType, onProgress });
 *
 *   await r2.from('nif-videos').remove([path1, path2]);
 *
 * NOTE: an earlier version of this file was accidentally a copy of the
 * Worker's own source (an `export default { async fetch(request, env, ctx) }`
 * handler) instead of a browser client — that object has no `.from()` method,
 * so every call site above was throwing `r2.from is not a function` the
 * moment it ran. This file replaces that with an actual client.
 * ════════════════════════════════════════════════════════════
 */

import { supabase } from './supabaseClient.js';
import { runtimeConfig } from './runtime-config.js';

const WORKER_URL = (runtimeConfig.r2WorkerUrl || '').replace(/\/$/, '');

if (!WORKER_URL) {
  console.warn('[FUMOCA] r2WorkerUrl is not configured in config.js — uploads and file deletes will fail.');
}

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('Not signed in — please sign in and try again.');
  return token;
}

/** PUT `body` to `uploadUrl` with real progress events. */
function putWithProgress(uploadUrl, body, contentType, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    // Only send our own bearer token to our own Worker. A presigned R2/S3
    // URL is self-authenticating via its query-string signature — sending
    // an extra Authorization header there is unnecessary and, on some S3-
    // compatible setups, can trip CORS preflight for no benefit.
    if (WORKER_URL && uploadUrl.startsWith(WORKER_URL)) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }
    xhr.upload.onprogress = (evt) => {
      if (typeof onProgress === 'function' && evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error('Network error during upload — check your connection and try again.'));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    xhr.send(body);
  });
}

function bucketRef(bucketName) {
  return {
    /**
     * @param {string} path - key/path within the bucket
     * @param {Blob|File} fileOrBlob
     * @param {{contentType?: string, onProgress?: (pct:number)=>void}} [opts]
     * @returns {Promise<{publicUrl: string|null, fileKey: string|null, error: Error|null}>}
     */
    async upload(path, fileOrBlob, opts = {}) {
      if (!WORKER_URL) {
        return { publicUrl: null, fileKey: null, error: new Error('r2WorkerUrl is not configured in config.js') };
      }
      try {
        const token = await getAccessToken();
        const contentType = opts.contentType || fileOrBlob?.type || 'application/octet-stream';

        // 1) Ask the Worker where to upload.
        const presignResp = await fetch(`${WORKER_URL}/upload/presign`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ bucket: bucketName, path, contentType }),
        });

        const presignText = await presignResp.text();
        let presignData = null;
        try { presignData = JSON.parse(presignText); } catch { /* leave null, handled below */ }

        if (!presignResp.ok || !presignData?.uploadUrl) {
          const msg = presignData?.error || presignText || `Presign request failed (${presignResp.status})`;
          return { publicUrl: null, fileKey: null, error: new Error(msg) };
        }

        const { uploadUrl, fileKey, publicUrl } = presignData;

        // 2) Send the actual bytes, reporting real progress as they go.
        await putWithProgress(uploadUrl, fileOrBlob, contentType, token, opts.onProgress);

        return { publicUrl, fileKey, error: null };
      } catch (err) {
        return { publicUrl: null, fileKey: null, error: err instanceof Error ? err : new Error(String(err)) };
      }
    },

    /**
     * @param {string[]} paths
     * @returns {Promise<{error: Error|null}>}
     */
    async remove(paths) {
      if (!WORKER_URL) {
        return { error: new Error('r2WorkerUrl is not configured in config.js') };
      }
      try {
        const token = await getAccessToken();
        const list = Array.isArray(paths) ? paths : [paths];
        await Promise.all(list.map((p) =>
          fetch(`${WORKER_URL}/file/${encodeURIComponent(p)}?bucket=${encodeURIComponent(bucketName)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          })
        ));
        return { error: null };
      } catch (err) {
        return { error: err instanceof Error ? err : new Error(String(err)) };
      }
    },
  };
}

const r2 = {
  from(bucketName) {
    return bucketRef(bucketName);
  },
};

// Both import styles are used across the codebase (`import r2 from`
// and `import { r2 } from`) — export both so every existing call site works.
export default r2;
export { r2 };
