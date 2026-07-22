import r2 from '../r2Client.js';
import { supabase } from '../supabaseClient.js';

const feedGrid = document.getElementById('feedGrid');
const searchInput = document.getElementById('searchInput');
const tabs = Array.from(document.querySelectorAll('.tab'));

let allPosts = [];
let activeFilter = 'all';
let currentUserId = null;
let currentUserRole = null;
let likedIds = new Set();

async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function firstNonEmpty(...values) {
  return values.find(v => typeof v === 'string' && v.trim()) || '';
}

function resolveUrl(row) {
  return firstNonEmpty(row.nif_url, row.output_url, row.public_url,
    row.file_url, row.external_nif_url, row.provider_nif_url);
}
function resolveThumbnail(row) {
  return firstNonEmpty(row.thumbnail_url, row.poster_url, row.preview_image_url);
}
function resolvePreviewVideo(row) {
  return firstNonEmpty(row.preview_video_url, row.teaser_video_url, row.video_url);
}

function normalizeStatus(status, url) {
  const raw = String(status || '').toLowerCase();
  if (['done','ready','published','complete','completed'].includes(raw)) return 'done';
  if (['processing','running','training','rendering'].includes(raw)) return 'processing';
  if (['failed','error'].includes(raw)) return 'failed';
  if (raw === 'queued' || raw === 'pending') return 'queued';
  return url ? 'done' : 'queued';
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff/86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function badgeClass(s) { return s === 'done' ? '' : s === 'processing' ? 'processing' : s === 'failed' ? 'failed' : 'queued'; }
function badgeLabel(s) { return s === 'done' ? '🧊 Ready' : s === 'processing' ? '⚙️ Processing' : s === 'failed' ? '❌ Failed' : '⏳ Queued'; }
function placeholderClass(s) { return s === 'processing' ? 'processing' : s === 'failed' ? 'failed' : s === 'done' ? '' : 'queued'; }
function placeholderIcon(s) { return s === 'done' ? '🧊' : s === 'processing' ? '⚙️' : s === 'failed' ? '❌' : '⏳'; }
function progressPct(post) { return Math.min(100, Number(post.processing_progress ?? post.progress_percent ?? 0)); }
function providerChip(post) {
  const label = firstNonEmpty(post.provider_name, post.source_type === 'external' ? 'External provider' : 'FUMOCA');
  return `<span class="post-tag">${esc(label)}</span>`;
}
function isAdminRole(role) { return ['admin','super_admin','owner'].includes(String(role||'').toLowerCase()); }
function canManagePost(post) { return !!(currentUserId && (post.user_id === currentUserId || isAdminRole(currentUserRole))); }

function extractStoragePath(urlString) {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const u = new URL(urlString, window.location.origin);
    const m = u.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/) ||
              u.pathname.match(/\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/) ||
              u.pathname.match(/\/storage\/v1\/object\/auth\/([^/]+)\/(.+)$/);
    if (!m) return null;
    return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]).replace(/^public\//,'') };
  } catch (_) { return null; }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  let t = document.getElementById('fumoToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'fumoToast';
    t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);padding:12px 22px;border-radius:14px;font-weight:700;font-size:14px;z-index:9999;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none;backdrop-filter:blur(8px);';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = isError ? 'rgba(200,30,30,.95)' : 'rgba(20,20,20,.97)';
  t.style.color = isError ? '#fff' : '#C8FF00';
  t.style.border = `1px solid ${isError ? 'rgba(255,60,60,.4)' : 'rgba(200,255,0,.3)'}`;
  t.style.opacity = '1';
  t.style.transform = 'translateX(-50%) translateY(0)';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(10px)'; }, 3200);
}

// ─── CORE DELETE ─────────────────────────────────────────────────────────────
// Deletes: storage files (video + nif + thumbnail), reconstruction_jobs, nif row.
async function deletePostRecord(post, opts = {}) {
  const { silent = false } = opts;

  // 1. Collect storage paths
  const filesToDelete = [];
  if (post.video_path && post.video_bucket) {
    filesToDelete.push({ bucket: post.video_bucket, path: post.video_path });
  } else if (post.video_url) {
    const p = extractStoragePath(post.video_url);
    if (p) filesToDelete.push(p);
  }
  // Nif output (only if not external)
  const nifUrl = resolveUrl(post);
  if (nifUrl && !post.external_nif_url) {
    const p = extractStoragePath(nifUrl);
    if (p) filesToDelete.push(p);
  }
  // Thumbnail
  const thumb = resolveThumbnail(post);
  if (thumb) { const p = extractStoragePath(thumb); if (p) filesToDelete.push(p); }

  // 2. Delete storage (best-effort — don't block on RLS or missing files)
  const grouped = {};
  filesToDelete.forEach(({ bucket, path }) => {
    if (!grouped[bucket]) grouped[bucket] = [];
    grouped[bucket].push(path);
  });
  await Promise.allSettled(
    Object.entries(grouped).map(([bucket, paths]) =>
      r2.from(bucket).remove(paths)
    )
  );

  // 3. Delete processing jobs (cascade handles it too, but explicit is safer for RLS)
  await supabase.from('reconstruction_jobs').delete().eq('nif_file_id', post.id);

  // 4. Delete nif file row
  const { error } = await supabase.from('nif_files').delete().eq('id', post.id);
  if (error) throw error;

  // 5. Animate card out
  const card = document.querySelector(`article[data-id="${post.id}"]`);
  if (card) {
    card.style.transition = 'opacity .3s, transform .3s';
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => card.remove(), 340);
  }

  // 6. Remove from memory
  allPosts = allPosts.filter(p => p.id !== post.id);
  if (!silent) showToast('Capture deleted.', false);
}

// ─── BULK DELETE ALL ──────────────────────────────────────────────────────────
async function deleteAllNifsForCurrentUser() {
  if (!currentUserId) return;
  const mine = allPosts.filter(p => p.user_id === currentUserId);
  if (!mine.length) { showToast('You have no captures to delete.', false); return; }
  if (!window.confirm(`Delete ALL ${mine.length} of your captures?\n\nThis removes capture records, processing jobs and stored files. This cannot be undone.`)) return;

  const btn = document.getElementById('deleteAllMyBtn');
  if (btn) { btn.disabled = true; btn.textContent = `Deleting ${mine.length}…`; }
  let deleted = 0;
  for (const post of mine) {
    try { await deletePostRecord(post, { silent: true }); deleted++; }
    catch (err) { console.error('[FUMOCA deleteAll]', post.id, err); }
  }
  if (btn) { btn.disabled = false; btn.textContent = '🗑️ Delete All My Captures'; }
  showToast(`Deleted ${deleted} / ${mine.length} captures.`, false);
  updateManageBtns();
}

// ─── BULK DELETE FAILED ───────────────────────────────────────────────────────
async function deleteFailedUploadsForCurrentUser() {
  if (!currentUserId) return;
  const failed = allPosts.filter(p => p.user_id === currentUserId && normalizeStatus(p.status, resolveUrl(p)) === 'failed');
  if (!failed.length) { showToast('No failed uploads to clean up.', false); return; }
  if (!window.confirm(`Delete ${failed.length} failed upload(s)? This removes the records and stored files.`)) return;

  const btn = document.getElementById('bulkDeleteFailedBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  let deleted = 0;
  for (const post of failed) {
    try { await deletePostRecord(post, { silent: true }); deleted++; }
    catch (err) { console.error('[FUMOCA deleteFailedUploads]', post.id, err); }
  }
  if (btn) { btn.disabled = false; btn.textContent = '🗑️ Delete Failed Uploads'; }
  showToast(`Deleted ${deleted} failed upload(s).`, false);
  updateManageBtns();
}

// ─── RENDER POST ──────────────────────────────────────────────────────────────
function renderPost(post) {
  const url = resolveUrl(post);
  const previewVideo = resolvePreviewVideo(post);
  const thumb = resolveThumbnail(post);
  const teaserVisual = previewVideo
    ? `<video class="post-teaser-video" src="${esc(previewVideo)}" ${thumb ? `poster="${esc(thumb)}"` : ''} muted loop playsinline preload="metadata"></video>`
    : '';
  const status = normalizeStatus(post.status, url);
  const canOpen = status === 'done' && !!url;
  const pct = progressPct(post);
  const liked = likedIds.has(post.id);
  const canManage = canManagePost(post);

  const avatarInner = post.avatar_url
    ? `<img src="${esc(post.avatar_url)}" alt="${esc(post.username)}" loading="lazy">`
    : esc((post.username || 'U')[0].toUpperCase());

  const visual = thumb
    ? `<img src="${esc(thumb)}" alt="${esc(post.title)}" loading="lazy">${teaserVisual}`
    : previewVideo
      ? `${teaserVisual}<div class="post-visual-placeholder processing"><div class="placeholder-icon">▶</div></div>`
      : `<div class="post-visual-placeholder ${placeholderClass(status)}"><div class="placeholder-icon">${placeholderIcon(status)}</div></div>`;

  const tagPills = (Array.isArray(post.tags) && post.tags.length ? post.tags : [])
    .slice(0,5).map(t => `<span class="post-tag">${esc(String(t).startsWith('#') ? t : '#'+t)}</span>`).join('');

  const socialPill = previewVideo ? `<span class="post-tag">▶ Social teaser</span>` : '';

  const manageMenu = canManage ? `
    <div class="post-manage-wrap" style="position:relative;margin-left:auto;">
      <button class="manage-toggle-btn" title="Manage" style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);border-radius:8px;padding:5px 10px;color:#aaa;font-size:15px;cursor:pointer;line-height:1;">⋯</button>
      <div class="post-manage-dropdown" style="display:none;position:absolute;right:0;top:34px;min-width:195px;background:#1c1c1c;border:1px solid rgba(255,255,255,.12);border-radius:12px;z-index:200;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.55);">
        ${canOpen ? `<button class="manage-item" data-action="edit-nif" style="display:flex;align-items:center;gap:9px;width:100%;padding:12px 16px;background:none;border:none;border-bottom:1px solid rgba(255,255,255,.07);color:#FAFAFA;font:inherit;font-size:13px;cursor:pointer;">✏️ Edit in Editor</button>` : ''}
        <button class="manage-item" data-action="delete-upload" style="display:flex;align-items:center;gap:9px;width:100%;padding:12px 16px;background:none;border:none;color:#ff9d9d;font:inherit;font-size:13px;cursor:pointer;">🗑️ Delete this capture</button>
      </div>
    </div>` : '';

  const article = document.createElement('article');
  article.className = 'post';
  article.dataset.id = post.id;

  article.innerHTML = `
    <div class="post-author">
      <div class="avatar">${avatarInner}</div>
      <div class="author-meta">
        <div class="author-name">${esc(post.username || 'Unknown')}</div>
        <div class="author-time">${timeAgo(post.created_at)}</div>
      </div>
      <div class="post-badge ${badgeClass(status)}">${badgeLabel(status)}</div>
      ${manageMenu}
    </div>
    <div class="post-visual" ${canOpen ? `role="button" tabindex="0" aria-label="Open capture ${esc(post.title)}"` : ''}>
      ${visual}
      ${canOpen ? `<div class="open-overlay"><div class="open-pill">Open Capture</div></div>` : ''}
    </div>
    ${status === 'processing' && pct > 0 ? `<div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>` : ''}
    <div class="post-body">
      <div class="post-title">${esc(post.title || 'Untitled Capture')}</div>
      ${post.description ? `<div class="post-desc">${esc(post.description)}</div>` : ''}
      <div class="post-tags">${providerChip(post)}${socialPill}${tagPills}</div>
    </div>
    <div class="post-actions">
      <button class="action-btn like-btn ${liked ? 'liked' : ''}" data-id="${esc(post.id)}">
        <span class="icon">${liked ? '❤️' : '🤍'}</span>
        <span class="like-count">${Number(post.like_count || 0)}</span>
      </button>
      ${previewVideo
        ? `<button class="action-btn preview-btn"><span class="icon">🎬</span><span>Teaser</span></button>`
        : `<button class="action-btn" disabled><span class="icon">💬</span><span>${Number(post.comment_count || 0)}</span></button>`}
      ${canOpen
        ? `<button class="open-nif-btn" data-id="${esc(post.id)}" data-url="${esc(url)}">View →</button>`
        : `<button class="open-nif-btn" disabled>${badgeLabel(status)}</button>`}
      ${canManagePost(post) && canOpen
        ? `<button class="edit-nif-btn" data-action="edit-nif-inline" data-id="${esc(post.id)}" data-url="${esc(url)}" title="Edit in Editor">✏️ Edit</button>`
        : ''}
    </div>`;

  // visual hover + click + double-tap-to-like (additive — does NOT delay the
  // existing single-tap-to-open, which stays exactly as responsive as before)
  if (canOpen) {
    const vis = article.querySelector('.post-visual');
    const vid = article.querySelector('.post-teaser-video');
    vis.addEventListener('mouseenter', () => vid?.play?.().catch?.(() => {}));
    vis.addEventListener('mouseleave', () => { if (vid) { vid.pause(); vid.currentTime = 0; } });

    let lastTap = 0;
    vis.addEventListener('click', (e) => {
      const isDoubleTap = Date.now() - lastTap < 320;
      lastTap = Date.now();
      if (isDoubleTap) {
        // Second rapid tap: show the heart burst + like, on top of whatever
        // the first tap already triggered (opening the viewer) — this is a
        // bonus gesture layered on the existing behavior, not a replacement.
        const burst = document.createElement('div');
        burst.className = 'heart-burst';
        burst.textContent = '❤️';
        burst.style.left = `${e.offsetX ?? vis.clientWidth / 2}px`;
        burst.style.top = `${e.offsetY ?? vis.clientHeight / 2}px`;
        vis.appendChild(burst);
        burst.addEventListener('animationend', () => burst.remove());
        const likeBtn = article.querySelector('.like-btn');
        if (likeBtn && !likeBtn.classList.contains('liked')) toggleLike(post.id, likeBtn);
        return; // don't also re-trigger openViewer on the double-tap itself
      }
      openViewer(post);
    });
    vis.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); openViewer(post); } });
  }

  article.querySelector(".open-nif-btn:not([disabled])")?.addEventListener("click", () => openViewer(post));
  article.querySelector("[data-action=\"edit-nif-inline\"]")?.addEventListener("click", e => {
    e.stopPropagation();
    const fileUrl = resolveUrl(post);
    if (!fileUrl) { showToast("No capture file to edit", true); return; }
    const p = new URLSearchParams();
    // Use nif_url for viewer — output_url may be .ply which viewer cannot render
  const editUrl = post.nif_url || (post.output_url && !post.output_url.toLowerCase().endsWith('.ply') ? post.output_url : null) || fileUrl;
  p.set("file", editUrl); p.set("nifId", post.id); p.set("back", window.location.href);
    const mediaType = String(post.media_type || post.source_type || "").toLowerCase();
    const isMedia = ["video","photo","image","mp4","mov","jpg","png"].some(t => mediaType.includes(t));
    window.location.href = isMedia ? `media-edit.html?${p.toString()}` : `edit.html?${p.toString()}`;
  });
  article.querySelector('.like-btn')?.addEventListener('click', () => toggleLike(post.id, article.querySelector('.like-btn')));
  article.querySelector('.preview-btn')?.addEventListener('click', e => { e.stopPropagation(); openViewer(post, true); });

  // manage dropdown
  const toggleBtn = article.querySelector('.manage-toggle-btn');
  const dropdown = article.querySelector('.post-manage-dropdown');
  if (toggleBtn && dropdown) {
    toggleBtn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.post-manage-dropdown').forEach(d => { if (d!==dropdown) d.style.display='none'; });
      dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });
  }

  // delete
  article.querySelector('[data-action="delete-upload"]')?.addEventListener('click', async e => {
    e.stopPropagation();
    if (dropdown) dropdown.style.display = 'none';
    const title = post.title || 'this capture';
    if (!window.confirm(`Delete "${title}"?\n\nThis removes the record, processing job and stored files. Cannot be undone.`)) return;
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      await deletePostRecord(post, { silent: false });
      updateManageBtns();
    } catch (err) {
      console.error('[FUMOCA feed delete]', err);
      showToast(`Delete failed: ${err?.message || 'unknown error'}`, true);
      btn.disabled = false; btn.textContent = '🗑️ Delete this capture';
    }
  });

  // edit in editor — route to edit.html (nif Studio) for nifs, media-edit.html for video/photo
  article.querySelector('[data-action="edit-nif"]')?.addEventListener('click', e => {
    e.stopPropagation();
    if (dropdown) dropdown.style.display = 'none';
    const fileUrl = resolveUrl(post);
    if (!fileUrl) return;
    const p = new URLSearchParams();
    p.set('file', fileUrl); p.set('nifId', post.id); p.set('back', window.location.href);
    // Route media posts to media-edit, nifs to edit studio
    const mediaType = String(post.media_type || post.source_type || '').toLowerCase();
    const isMedia = ['video','photo','image','mp4','mov','jpg','png'].some(t => mediaType.includes(t));
    window.location.href = isMedia ? `media-edit.html?${p.toString()}` : `edit.html?${p.toString()}`;
  });

  return article;
}

function openViewer(post, openTeaser = false) {
  try {
    sessionStorage.setItem('fumoca:selectedNif', JSON.stringify({
      id: post?.id||'', title: post?.title||'', description: post?.description||'',
      thumbnail: resolveThumbnail(post), previewVideo: resolvePreviewVideo(post),
      provider: post?.provider_name||'', status: post?.status||'', file: resolveUrl(post)
    }));
  } catch (_) {}
  const p = new URLSearchParams();
  const url = resolveUrl(post); const thumb = resolveThumbnail(post); const previewVideo = resolvePreviewVideo(post);
  if (post?.id) p.set('nifId', post.id);
  if (url) p.set('file', url);
  if (thumb) p.set('thumbnail', thumb);
  if (previewVideo) p.set('previewVideo', previewVideo);
  if (openTeaser) p.set('autoplayPreview', '1');
  window.location.href = `viewer.html?${p.toString()}`;
}

async function toggleLike(nifId, btn) {
  if (!currentUserId || !btn) return;
  const isLiked = likedIds.has(nifId);
  const countEl = btn.querySelector('.like-count');
  const iconEl = btn.querySelector('.icon');
  const current = parseInt(countEl.textContent, 10) || 0;
  if (isLiked) {
    likedIds.delete(nifId); btn.classList.remove('liked'); iconEl.textContent = '🤍';
    countEl.textContent = Math.max(0, current-1);
    await supabase.from('likes').delete().eq('user_id', currentUserId).eq('nif_id', nifId);
  } else {
    likedIds.add(nifId); btn.classList.add('liked'); iconEl.textContent = '❤️';
    countEl.textContent = current+1;
    await supabase.from('likes').insert({ user_id: currentUserId, nif_id: nifId });
  }
}

function renderFeed(posts) {
  feedGrid.innerHTML = '';
  if (!posts.length) {
    feedGrid.innerHTML = `<div class="feed-status"><strong>Nothing here</strong>No captures match this filter.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  posts.forEach(p => frag.appendChild(renderPost(p)));
  feedGrid.appendChild(frag);
}

function updateManageBtns() {
  if (!currentUserId) return;
  const myCount = allPosts.filter(p => p.user_id === currentUserId).length;
  const failedCount = allPosts.filter(p => p.user_id === currentUserId && normalizeStatus(p.status, resolveUrl(p)) === 'failed').length;
  const allBtn = document.getElementById('deleteAllMyBtn');
  const failBtn = document.getElementById('bulkDeleteFailedBtn');
  if (allBtn) allBtn.textContent = `🗑️ Delete All My Captures (${myCount})`;
  if (failBtn) failBtn.textContent = `🗑️ Delete Failed (${failedCount})`;
}

function applyFilters() {
  const q = (searchInput?.value || '').trim().toLowerCase();
  const filtered = allPosts.filter(post => {
    const status = normalizeStatus(post.status, resolveUrl(post));
    const matchTab = activeFilter === 'all' || status === activeFilter;
    const hay = [post.title, post.description, post.username, post.category, post.provider_name, ...(post.tags||[])].join(' ').toLowerCase();
    return matchTab && (!q || hay.includes(q));
  });
  renderFeed(filtered);
  updateManageBtns();
}

async function fetchFeedNifs() {
  const visibilityFilter = ['public', 'followers'];
  const batches = [];
  const { data: publicRows, error: publicError } = await supabase.from('nif_files').select('*')
    .in('visibility', visibilityFilter).eq('is_demo', false).order('created_at', { ascending: false }).limit(60);
  if (publicError) throw publicError;
  batches.push(...(publicRows || []));
  if (currentUserId) {
    const { data: ownRows, error: ownError } = await supabase.from('nif_files').select('*')
      .eq('user_id', currentUserId).order('created_at', { ascending: false }).limit(60);
    if (ownError) throw ownError;
    batches.push(...(ownRows || []));
  }
  const dedup = new Map();
  batches.forEach(row => { if (row?.id) dedup.set(row.id, row); });
  return Array.from(dedup.values()).sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
}

async function fetchProfilesFor(rows) {
  const userIds = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  if (!userIds.length) return new Map();
  const { data, error } = await supabase.from('profiles').select('id, username, avatar_url, first_name, last_name').in('id', userIds);
  if (error) throw error;
  return new Map((data || []).map(p => [p.id, p]));
}

function skeletonCards(count = 3) {
  const one = `
    <div class="skeleton-card">
      <div class="skeleton-author">
        <div class="skeleton-avatar skeleton-shimmer"></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;">
          <div class="skeleton-line skeleton-shimmer" style="width:38%;"></div>
          <div class="skeleton-line skeleton-shimmer" style="width:22%;height:9px;"></div>
        </div>
      </div>
      <div class="skeleton-visual skeleton-shimmer"></div>
      <div class="skeleton-body">
        <div class="skeleton-line skeleton-shimmer" style="width:60%;"></div>
        <div class="skeleton-line skeleton-shimmer" style="width:85%;height:9px;"></div>
      </div>
    </div>`;
  return one.repeat(count);
}

async function loadFeed() {
  feedGrid.innerHTML = skeletonCards(3);
  try {
    const rows = await fetchFeedNifs();
    if (currentUserId) {
      const { data: myLikes } = await supabase.from('likes').select('nif_id').eq('user_id', currentUserId);
      likedIds = new Set((myLikes||[]).map(l => l.nif_id));
    }
    let profilesById = new Map();
    try { profilesById = await fetchProfilesFor(rows); }
    catch (e) { console.warn('[FUMOCA feed] profile lookup failed', e); }
    allPosts = rows.map(row => {
      const profile = profilesById.get(row.user_id) || {};
      const url = resolveUrl(row);
      const ns = normalizeStatus(row.status, url);
      return {
        ...row, status: ns,
        username: profile.username || profile.first_name || 'fumoca_user',
        avatar_url: profile.avatar_url || '',
        thumbnail_url: resolveThumbnail(row),
        preview_video_url: resolvePreviewVideo(row),
        source_type: row.source_type || (row.external_nif_url ? 'external' : 'fumoca'),
        provider_name: row.provider_name || (row.external_nif_url ? 'External provider' : 'FUMOCA'),
        isViewable: ns === 'done' && !!url,
      };
    });
    applyFilters();
  } catch (error) {
    console.error('[FUMOCA feed]', error);
    feedGrid.innerHTML = `<div class="feed-status"><strong>Failed to load</strong>${esc(error.message||'Unknown error')}</div>`;
  }
}

async function init() {
  const user = await getCurrentUser();
  currentUserId = user?.id || null;
  currentUserRole = user?.user_metadata?.role || null;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter || 'all';
      applyFilters();
    });
  });

  searchInput?.addEventListener('input', applyFilters);

  document.getElementById('bulkDeleteFailedBtn')?.addEventListener('click', deleteFailedUploadsForCurrentUser);
  document.getElementById('deleteAllMyBtn')?.addEventListener('click', deleteAllNifsForCurrentUser);

  // Close all manage dropdowns when clicking outside them
  document.addEventListener('click', () => {
    document.querySelectorAll('.post-manage-dropdown').forEach(d => { d.style.display = 'none'; });
  });

  await loadFeed();
  setInterval(loadFeed, 30000);
}

init();

// ─── v60: Live Edit from Feed ─────────────────────────────────────────────────
window.editLiveFromFeed = async function(nifId, mediaType) {
  if (!nifId) return;
  const sb = window._fumocaSupabase;
  if (!sb) return;
  if (!sb) { console.warn('[Feed] Supabase not ready'); return; }
  const { data: nif } = await sb.from('nif_files').select('nif_url,video_url,source_video_url').eq('id', nifId).single();
  if (!nif) { showToast("Capture not found", true); return; }
  const p = new URLSearchParams();
  p.set('nifId', nifId);
  p.set('live', 'true');
  p.set('back', window.location.href);
  const mt = String(mediaType || 'nif').toLowerCase();
  if (['video','photo','image'].includes(mt)) {
    const file = nif.video_url || nif.source_video_url || '';
    if (file) p.set('file', file);
    window.location.href = `media-edit.html?${p.toString()}`;
  } else {
    if (nif.nif_url) p.set('file', nif.nif_url);
    window.location.href = `edit.html?${p.toString()}`;
  }
};

// ─── v60: saveLiveEdit (global helper) ───────────────────────────────────────
window.saveLiveEdit = async function(recipeDelta) {
  const rec = window._fumocaCurrentRecord;
  const sb  = window._fumocaSupabase;
  if (!rec?.id || !sb) return false;
  const current = typeof rec.edit_recipe === 'object' ? rec.edit_recipe : {};
  const merged  = { ...current, ...recipeDelta, lastSaved: new Date().toISOString() };
  const payload = {
    edit_recipe:    merged,
    last_edited_at: new Date().toISOString(),
  };
  if (window._fumocaEditedNifUrl) payload.nif_url = window._fumocaEditedNifUrl;
  const { error } = await sb.from('nif_files').update(payload).eq('id', rec.id);
  if (!error) {
    window._fumocaCurrentRecord = { ...rec, edit_recipe: merged };
    window.dispatchEvent(new CustomEvent('fumoca:liveEditSaved', { detail: { nifId: rec.id } }));
  }
  return !error;
};
