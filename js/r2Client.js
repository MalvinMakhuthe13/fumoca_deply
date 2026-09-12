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
 *
 * UPLOAD TRANSPORT: browser → presigned-R2-S3-URL direct PUT was found to
 * fail on large files (85MB video PUTs were dying mid-transfer with
 * net::ERR_CONNECTION..., even though the presign step and CORS preflight
 * both succeeded). Files at or above WORKER_STREAM_THRESHOLD_BYTES are now
 * streamed through the Worker's `PUT /upload/:key` route instead, which is
 * the transport the Worker itself already supports. Small files still use
 * the presigned direct-to-R2 path when the Worker supplies one.
 * ════════════════════════════════════════════════════════════
 */

import { supabase } from './supabaseClient.js';
import { runtimeConfig } from './runtime-config.js';

const WORKER_URL = (runtimeConfig.r2WorkerUrl || '').replace(/\/$/, '');

// Files at or above this size skip the presigned direct-to-R2 PUT and
// stream through the Worker instead. 20MB is comfortably below the
// point where the direct-to-R2 PUT was observed failing (85MB), while
// still letting small thumbnail/avatar uploads use the lighter-weight
// presigned path.
const WORKER_STREAM_THRESHOLD_BYTES = 20 * 1024 * 1024;

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
function putWithProgress(uploadUrl, body, contentType, token, onProgress, { isWorkerUrl } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    if (contentType) xhr.setRequestHeader('Content-Type', contentType);
    // Only send our own bearer token to our own Worker. A presigned R2/S3
    // URL is self-authenticating via its query-string signature — sending
    // an extra Authorization header there is unnecessary and, on some S3-
    // compatible setups, can trip CORS preflight for no benefit.
    if (isWorkerUrl) {
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
    xhr.onerror = () => reject(new Error(
      isWorkerUrl
        ? 'Upload failed — the connection to the storage server was interrupted. Please retry.'
        : 'Upload failed — the connection to storage was interrupted partway through. Please retry.'
    ));
    xhr.onabort = () => reject(new Error('Upload aborted'));
    xhr.send(body);
  });
}


// ── Multipart upload helpers ───────────────────────────────────────────────────

const MULTIPART_PART_SIZE = 8 * 1024 * 1024;
const MULTIPART_MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerJson(url, method, token, body) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const responseText = await response.text();

  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch {
    // Keep data null.
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      responseText ||
      `Worker request failed (${response.status})`
    );
  }

  return data;
}

function uploadMultipartPart(
  uploadUrl,
  body,
  token,
  partNumber,
  totalBytes,
  uploadedBeforePart,
  onProgress
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (evt) => {
      if (
        typeof onProgress === 'function' &&
        evt.lengthComputable &&
        totalBytes > 0
      ) {
        const overallLoaded =
          uploadedBeforePart + Math.min(evt.loaded, body.size);

        onProgress(
          Math.min(100, Math.round((overallLoaded / totalBytes) * 100))
        );
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let data = null;

        try {
          data = JSON.parse(xhr.responseText || '{}');
        } catch {
          reject(new Error(
            `Multipart part ${partNumber} returned invalid JSON.`
          ));
          return;
        }

        if (!data?.etag) {
          reject(new Error(
            `Multipart part ${partNumber} completed without an ETag.`
          ));
          return;
        }

        resolve({
          partNumber,
          etag: data.etag,
        });
        return;
      }

      let message = xhr.responseText || xhr.statusText;

      try {
        const data = JSON.parse(xhr.responseText || '{}');
        message = data?.error || message;
      } catch {
        // Keep raw response.
      }

      reject(new Error(
        `Multipart part ${partNumber} failed (${xhr.status}): ${message}`
      ));
    };

    xhr.onerror = () => {
      reject(new Error(
        `Multipart part ${partNumber} failed — connection interrupted.`
      ));
    };

    xhr.onabort = () => {
      reject(new Error(
        `Multipart part ${partNumber} was aborted.`
      ));
    };

    xhr.send(body);
  });
}

async function uploadMultipart(
  bucketName,
  path,
  fileOrBlob,
  contentType,
  token,
  onProgress
) {
  const createUrl =
    `${WORKER_URL}/upload/multipart/create?bucket=${encodeURIComponent(bucketName)}`;

  const createData = await workerJson(
    createUrl,
    'POST',
    token,
    {
      path,
      contentType,
    }
  );

  const uploadId = createData?.uploadId;
  const fileKey = createData?.fileKey;
  const initialPublicUrl = createData?.publicUrl;

  if (!uploadId || !fileKey) {
    throw new Error(
      'Worker did not return a multipart upload ID and file key.'
    );
  }

  const totalBytes = fileOrBlob.size;
  const totalParts = Math.ceil(totalBytes / MULTIPART_PART_SIZE);
  const parts = [];

  let uploadedBeforePart = 0;

  try {
    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * MULTIPART_PART_SIZE;
      const end = Math.min(
        start + MULTIPART_PART_SIZE,
        totalBytes
      );

      const partBlob = fileOrBlob.slice(start, end);

      const partUrl =
        `${WORKER_URL}/upload/multipart/part` +
        `?bucket=${encodeURIComponent(bucketName)}` +
        `&uploadId=${encodeURIComponent(uploadId)}` +
        `&key=${encodeURIComponent(fileKey)}` +
        `&partNumber=${partNumber}`;

      let result = null;
      let lastError = null;

      for (
        let attempt = 1;
        attempt <= MULTIPART_MAX_RETRIES;
        attempt++
      ) {
        try {
          result = await uploadMultipartPart(
            partUrl,
            partBlob,
            token,
            partNumber,
            totalBytes,
            uploadedBeforePart,
            onProgress
          );
          break;
        } catch (err) {
          lastError =
            err instanceof Error
              ? err
              : new Error(String(err));

          console.warn(
            `[FUMOCA] Multipart part ${partNumber} attempt ${attempt}/${MULTIPART_MAX_RETRIES} failed:`,
            lastError.message
          );

          if (attempt < MULTIPART_MAX_RETRIES) {
            await sleep(1000 * Math.pow(2, attempt - 1));
          }
        }
      }

      if (!result) {
        throw lastError || new Error(
          `Multipart part ${partNumber} failed.`
        );
      }

      parts.push({
        partNumber: result.partNumber,
        etag: result.etag,
      });

      uploadedBeforePart += partBlob.size;

      if (
        typeof onProgress === 'function' &&
        totalBytes > 0
      ) {
        onProgress(
          Math.min(
            100,
            Math.round((uploadedBeforePart / totalBytes) * 100)
          )
        );
      }
    }

    const completeUrl =
      `${WORKER_URL}/upload/multipart/complete?bucket=${encodeURIComponent(bucketName)}`;

    const completeData = await workerJson(
      completeUrl,
      'POST',
      await getAccessToken(),
      {
        uploadId,
        key: fileKey,
        parts,
      }
    );

    if (!completeData?.fileKey) {
      throw new Error(
        'Worker completed the multipart upload without returning a file key.'
      );
    }

    if (typeof onProgress === 'function') {
      onProgress(100);
    }

    return {
      publicUrl:
        completeData.publicUrl ||
        initialPublicUrl ||
        `${WORKER_URL}/file/${encodeURIComponent(fileKey)}?bucket=${encodeURIComponent(bucketName)}`,
      fileKey: completeData.fileKey,
    };
  } catch (err) {
    try {
      const abortUrl =
        `${WORKER_URL}/upload/multipart/abort?bucket=${encodeURIComponent(bucketName)}`;

      await workerJson(
        abortUrl,
        'POST',
        await getAccessToken(true),
        {
          uploadId,
          key: fileKey,
        }
      );
    } catch (abortErr) {
      console.warn(
        '[FUMOCA] Multipart abort also failed:',
        abortErr?.message || abortErr
      );
    }

    throw err;
  }
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
        const size = fileOrBlob?.size ?? 0;
        const useWorkerStream = size >= WORKER_STREAM_THRESHOLD_BYTES;

        if (useWorkerStream) {
          // Large file: use R2 multipart upload through the Worker.
          // Each part is only 20MB, so no single Worker request carries
          // the entire file. This avoids Cloudflare request-body limits
          // and makes large browser uploads much more reliable.
          const multipartResult = await uploadMultipart(
            bucketName,
            path,
            fileOrBlob,
            contentType,
            token,
            opts.onProgress
          );

          return {
            publicUrl: multipartResult.publicUrl,
            fileKey: multipartResult.fileKey,
            error: null,
          };
        }

        // Small file: ask the Worker for a presigned URL and PUT directly to R2.
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
        const isWorkerUrl = WORKER_URL && uploadUrl.startsWith(WORKER_URL);

        await putWithProgress(uploadUrl, fileOrBlob, contentType, token, opts.onProgress, { isWorkerUrl });

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

  /**
   * Build a playable/downloadable URL for a key that's already in R2,
   * without needing a stored URL column. Needed because
   * engine-next/reconstruction/pipeline.py's _register() only ever writes
   * `r2_key` to nif_files — there is no nif_url/output_url/public_url
   * column in that table — so anything reading nif_files rows (feed,
   * viewer, profile) has to construct the URL itself from r2_key, the
   * same way uploads already get a `publicUrl` back from the Worker's
   * presign response.
   */
  publicUrl(bucketName, key) {
    if (!WORKER_URL || !key) return null;
    return `${WORKER_URL}/file/${encodeURIComponent(key)}?bucket=${encodeURIComponent(bucketName)}`;
  },
};

// Both import styles are used across the codebase (`import r2 from`
// and `import { r2 } from`) — export both so every existing call site works.
export default r2;
export { r2 };
