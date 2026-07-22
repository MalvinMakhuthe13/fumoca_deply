import r2 from '../r2Client.js';
import { supabase } from '../supabaseClient.js';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function normalizeStatus(status, url) {
  const raw = String(status || '').toLowerCase();
  if (['done', 'ready', 'published', 'complete', 'completed'].includes(raw)) return 'done';
  if (['processing', 'running', 'training', 'rendering'].includes(raw)) return 'processing';
  if (['failed', 'error'].includes(raw)) return 'failed';
  if (raw === 'queued' || raw === 'pending') return 'queued';
  return url ? 'done' : 'queued';
}

function firstNonEmpty(...values) {
  return values.find(v => typeof v === 'string' && v.trim()) || '';
}

function resolveUrl(row) {
  return firstNonEmpty(row.splat_url, row.output_url, row.public_url, row.file_url, row.external_splat_url, row.provider_splat_url);
}

function extractStoragePath(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const u = new URL(urlString, window.location.origin);
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:public|sign|auth)\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]).replace(/^public\//, '') };
  } catch (_) { return null; }
}

async function deleteUploadRecord(item) {
  const candidates = [
    item?.splat_url, item?.output_url, item?.public_url, item?.file_url, item?.external_splat_url, item?.provider_splat_url,
    item?.thumbnail_url, item?.poster_url, item?.preview_image_url,
    item?.preview_video_url, item?.teaser_video_url, item?.video_url, item?.source_video_url
  ].filter(Boolean);
  const explicitPaths = [
    item?.video_bucket && item?.video_path ? { bucket: item.video_bucket, path: item.video_path } : null,
    item?.splat_bucket && item?.splat_path ? { bucket: item.splat_bucket, path: item.splat_path } : null,
    item?.thumb_bucket && item?.thumbnail_path ? { bucket: item.thumb_bucket, path: item.thumbnail_path } : null,
  ].filter(Boolean);
  const removals = [...explicitPaths];
  for (const raw of candidates) {
    const hit = extractStoragePath(raw);
    if (hit) removals.push(hit);
  }
  const dedup = new Map();
  removals.forEach(item => dedup.set(`${item.bucket}:${item.path}`, item));
  for (const entry of dedup.values()) {
    try { await r2.from(entry.bucket).remove([entry.path]); } catch (_) {}
  }
  try { await supabase.from('processing_jobs').delete().eq('splat_id', item.id); } catch (_) {}
  try { await supabase.from('processing_jobs').delete().eq('user_id', item.user_id).eq('video_path', item.video_path); } catch (_) {}
  const { error } = await supabase.from('splats').delete().eq('id', item.id).eq('user_id', item.user_id);
  if (error) throw error;
}

let userId = null;
let uploads = [];

function renderRecent() {
  const recent = document.getElementById('recentSplats');
  if (!uploads.length) {
    recent.innerHTML = '<div class="empty-state">No uploads yet. Create your first splat from the Create page.</div>';
    return;
  }
  recent.innerHTML = uploads.slice(0, 6).map(item => `
    <div class="mini-item">
      <div class="mini-item-title">${esc(item.title || 'Untitled Splat')}</div>
      <div class="mini-item-sub">${esc(item.status || 'queued')} · ${new Date(item.created_at).toLocaleString()}</div>
    </div>
  `).join('');
}

function renderManage() {
  const host = document.getElementById('manageUploads');
  if (!uploads.length) {
    host.innerHTML = '<div class="empty-state">No uploads to manage yet.</div>';
    return;
  }
  host.innerHTML = uploads.map(item => {
    const status = normalizeStatus(item.status, resolveUrl(item));
    return `
      <div class="mini-item" data-id="${esc(item.id)}" style="display:flex;justify-content:space-between;gap:12px;align-items:center;">
        <div>
          <div class="mini-item-title">${esc(item.title || 'Untitled Splat')}</div>
          <div class="mini-item-sub">${esc(status)} · ${new Date(item.created_at).toLocaleString()}</div>
        </div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          ${status === 'done' ? `<a href="viewer.html?id=${encodeURIComponent(item.id)}" class="nav-item active" style="display:inline-flex;padding:10px 12px;">Open</a>` : ''}
          <button class="upload-btn manage-delete-btn" type="button" data-delete-id="${esc(item.id)}" style="padding:10px 14px;background:rgba(255,72,72,0.12);border-color:rgba(255,72,72,0.28);color:#ffb1b1;">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  host.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-delete-id');
      const item = uploads.find(row => row.id === id);
      if (!item) return;
      if (!window.confirm(`Delete "${item.title || 'Untitled Splat'}"? This cannot be undone.`)) return;
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      try {
        await deleteUploadRecord(item);
        uploads = uploads.filter(row => row.id !== id);
        document.getElementById('countSplats').textContent = uploads.length;
        renderRecent();
        renderManage();
      } catch (err) {
        console.error('[FUMOCA profile delete upload]', err);
        window.alert(err?.message || 'Failed to delete upload.');
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  });
}

async function bulkDeleteFailedUploads() {
  const failed = uploads.filter(item => normalizeStatus(item.status, resolveUrl(item)) === 'failed');
  if (!failed.length) {
    window.alert('You have no failed uploads to delete.');
    return;
  }
  if (!window.confirm(`Delete ${failed.length} failed upload${failed.length === 1 ? '' : 's'}?`)) return;
  let removed = 0;
  for (const item of [...failed]) {
    try {
      await deleteUploadRecord(item);
      uploads = uploads.filter(row => row.id !== item.id);
      removed++;
    } catch (err) {
      console.warn('[FUMOCA profile bulk delete failed]', item.id, err);
    }
  }
  document.getElementById('countSplats').textContent = uploads.length;
  renderRecent();
  renderManage();
  window.alert(`Deleted ${removed} failed upload${removed === 1 ? '' : 's'}.`);
}

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }
  userId = user.id;

  const username = user.user_metadata?.username || user.email.split('@')[0];
  const displayName = [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(' ') || username;

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  const { data: splats } = await supabase
    .from('splats')
    .select('id,user_id,status,title,created_at,splat_url,output_url,public_url,file_url,external_splat_url,provider_splat_url,thumbnail_url,poster_url,preview_image_url,preview_video_url,teaser_video_url,video_url,source_video_url,video_bucket,video_path,splat_bucket,splat_path,thumb_bucket,thumbnail_path')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  uploads = Array.isArray(splats) ? splats : [];

  document.getElementById('profileName').textContent = displayName;
  document.getElementById('profileHandle').textContent = '@' + username;
  document.getElementById('profileAvatar').textContent = (displayName || username)[0].toUpperCase();
  document.getElementById('countFollowers').textContent = profile?.follower_count ?? 0;
  document.getElementById('countFollowing').textContent = profile?.following_count ?? 0;
  document.getElementById('countSplats').textContent = uploads.length;

  renderRecent();
  renderManage();
  document.getElementById('bulkDeleteFailedBtn')?.addEventListener('click', bulkDeleteFailedUploads);
}

init();
