import { supabase } from '../supabaseClient.js';
import { runtimeConfig } from '../runtime-config.js';
import r2 from '../r2Client.js';
import { encodeNif } from './nif-format.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';

const VIDEO_BUCKET = 'nif-videos';
let selectedFile = null;
let selectedFiles = []; // used only in 'photos' mode
let selectedThumbnail = null;
let thumbnailPreviewUrl = null;
let uploadedThumbnail = null;
let tags = [];
let visibility = 'public';
let saleEnabled = false;
let printEnabled = false;
let currentUploadMode = 'pipeline';
window.currentUploadMode = currentUploadMode;

window.handleFileSelect = function(input) {
  if (currentUploadMode === 'photos') {
    if (input.files.length) setFiles(input.files);
  } else if (input.files[0]) setFile(input.files[0]);
};

document.getElementById('thumbnailFile')?.addEventListener('change', e => {
  const file = e.target.files?.[0] || null;
  if (thumbnailPreviewUrl) URL.revokeObjectURL(thumbnailPreviewUrl);
  thumbnailPreviewUrl = null;
  selectedThumbnail = file;
  const preview = document.getElementById('thumbnailPreview');
  if (!file) { preview.hidden = true; preview.style.display = 'none'; return; }
  if (!file.type.startsWith('image/')) {
    selectedThumbnail = null;
    e.target.value = '';
    return showMsg('Choose an image file for the thumbnail.', true);
  }
  if (file.size > 20 * 1024 * 1024) {
    selectedThumbnail = null;
    e.target.value = '';
    return showMsg('Thumbnail images must be 20 MB or smaller.', true);
  }
  thumbnailPreviewUrl = URL.createObjectURL(file);
  preview.src = thumbnailPreviewUrl;
  preview.hidden = false;
  preview.style.display = 'block';
  showMsg('Your chosen thumbnail is ready.', false);
});
window.handleDragOver = function(e) {
  if (currentUploadMode === 'external') return;
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('dragover');
};
window.handleDrop = function(e) {
  if (currentUploadMode === 'external') return;
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('dragover');
  if (currentUploadMode === 'photos') {
    if (e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
  } else if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
};

window.setUploadMode = function(mode) {
  const nextMode = mode === 'external' ? 'external' : mode === 'ply' ? 'ply' : mode === 'lidar' ? 'lidar' : mode === 'photos' ? 'photos' : 'pipeline';
  if (nextMode !== currentUploadMode) {
    selectedFile = null;
    selectedFiles = [];
    const sourceInput = document.getElementById('fileInput');
    if (sourceInput) sourceInput.value = '';
  }
  currentUploadMode = nextMode;
  window.currentUploadMode = currentUploadMode;

  const pipelineBtn = document.getElementById('modePipelineBtn');
  const photosBtn = document.getElementById('modePhotosBtn');
  const plyBtn = document.getElementById('modePlyBtn');
  const lidarBtn = document.getElementById('modeLidarBtn');
  const externalBtn = document.getElementById('modeExternalBtn');
  const externalFields = document.getElementById('externalFields');
  const uploadZone = document.getElementById('uploadZone');
  const submitLabel = document.getElementById('submitLabel');
  const submitBtn = document.getElementById('submitBtn');
  const fileInput = document.getElementById('fileInput');

  // Reset all buttons
  [pipelineBtn, photosBtn, plyBtn, lidarBtn, externalBtn].filter(Boolean).forEach(btn => {
    btn.style.borderColor = 'rgba(255,255,255,.12)';
    btn.style.background = 'rgba(255,255,255,.04)';
    btn.style.color = '#FAFAFA';
  });

  // Highlight active
  if (currentUploadMode === 'pipeline' && pipelineBtn) {
    pipelineBtn.style.borderColor = 'rgba(200,255,0,.3)';
    pipelineBtn.style.background = 'rgba(200,255,0,.08)';
    pipelineBtn.style.color = '#C8FF00';
  } else if (currentUploadMode === 'photos' && photosBtn) {
    photosBtn.style.borderColor = 'rgba(200,255,0,.3)';
    photosBtn.style.background = 'rgba(200,255,0,.08)';
    photosBtn.style.color = '#C8FF00';
  } else if (currentUploadMode === 'ply' && plyBtn) {
    plyBtn.style.borderColor = 'rgba(0,229,255,.4)';
    plyBtn.style.background = 'rgba(0,229,255,.1)';
    plyBtn.style.color = '#0ef';
  } else if (currentUploadMode === 'lidar' && lidarBtn) {
    lidarBtn.style.borderColor = 'rgba(0,229,255,.4)';
    lidarBtn.style.background = 'rgba(0,229,255,.1)';
    lidarBtn.style.color = '#0ef';
  } else if (externalBtn) {
    externalBtn.style.borderColor = 'rgba(200,255,0,.3)';
    externalBtn.style.background = 'rgba(200,255,0,.08)';
    externalBtn.style.color = '#C8FF00';
  }

  externalFields.style.display = currentUploadMode === 'external' ? 'block' : 'none';
  uploadZone.style.opacity = currentUploadMode === 'external' ? '0.55' : '1';

  if (currentUploadMode === 'photos') {
    // Multiple, image-only selection — real multi-view capture (needs 3+
    // images from different angles for COLMAP to triangulate real geometry).
    if (fileInput) { fileInput.accept = '.jpg,.jpeg,.png,image/jpeg,image/png'; fileInput.multiple = true; }
    uploadZone.querySelector('#uploadIcon').textContent = selectedFiles.length ? '✅' : '📸';
    uploadZone.querySelector('#uploadTitle').textContent = selectedFiles.length
      ? `${selectedFiles.length} photos selected` : 'Drop 3+ photos here';
    uploadZone.querySelector('#uploadSub').innerHTML = selectedFiles.length
      ? `<strong>${(selectedFiles.reduce((s,f)=>s+f.size,0) / 1024 / 1024).toFixed(1)} MB total</strong> · Ready to queue`
      : 'Walk around your subject, one photo every ~15°<br>Real multi-view reconstruction — same pipeline as video, no video required.';
    submitBtn.disabled = selectedFiles.length < 3;
    submitLabel.textContent = selectedFiles.length ? 'Upload and queue' : 'Select 3+ photos to start';
  } else if (currentUploadMode === 'ply') {
    // Switch file input to accept .ply and .nif
    if (fileInput) { fileInput.accept = '.splat,.ply,.nif'; fileInput.multiple = false; }
    uploadZone.querySelector('#uploadIcon').textContent = '📂';
    uploadZone.querySelector('#uploadTitle').textContent = selectedFile ? selectedFile.name : 'Drop a .splat, .ply or .nif file here';
    uploadZone.querySelector('#uploadSub').innerHTML = selectedFile
      ? `<strong>${(selectedFile.size / 1024 / 1024).toFixed(1)} MB</strong> · PLY ready`
      : '.splat, .ply or .nif · Existing .splat files can be converted to NIF in-browser without a GPU.';
    submitBtn.disabled = !selectedFile;
    submitLabel.textContent = selectedFile ? 'Upload & open in Studio' : 'Select a splat, PLY or NIF file';
    showMsg('PLY mode — drop a .ply capture file to upload directly and open in the editor.', false);
  } else if (currentUploadMode === 'lidar') {
    if (fileInput) { fileInput.accept = '.las,.xyz,.csv,.txt'; fileInput.multiple = false; }
    uploadZone.querySelector('#uploadIcon').textContent = '📡';
    uploadZone.querySelector('#uploadTitle').textContent = selectedFile ? selectedFile.name : 'Drop a LAS / XYZ point cloud here';
    uploadZone.querySelector('#uploadSub').innerHTML = selectedFile
      ? `<strong>${(selectedFile.size / 1024 / 1024).toFixed(1)} MB</strong> · LiDAR ready to convert and open`
      : 'Supports uncompressed LAS, XYZ, CSV and TXT point clouds · LAZ compression is not supported.';
    submitBtn.disabled = !selectedFile;
    submitLabel.textContent = selectedFile ? 'Upload LiDAR & open in Studio' : 'Select a LiDAR point cloud';
  } else if (currentUploadMode === 'external') {
    if (fileInput) { fileInput.accept = 'video/*'; fileInput.multiple = false; }
    uploadZone.querySelector('#uploadIcon').textContent = '🧊';
    uploadZone.querySelector('#uploadTitle').textContent = 'Publish a finished nif';
    uploadZone.querySelector('#uploadSub').innerHTML = 'Paste a ready-made nif URL, thumbnail and optional teaser video.';
    submitBtn.disabled = false;
    submitLabel.textContent = 'Publish finished nif';
    showMsg('External-provider mode is ready. Paste your finished scene links below.', false);
  } else {
    if (fileInput) { fileInput.accept = 'video/*'; fileInput.multiple = false; }
    uploadZone.querySelector('#uploadIcon').textContent = selectedFile ? '✅' : '🎬';
    uploadZone.querySelector('#uploadTitle').textContent = selectedFile ? selectedFile.name : 'Drop your video here';
    uploadZone.querySelector('#uploadSub').innerHTML = selectedFile
      ? `<strong>${(selectedFile.size / 1024 / 1024).toFixed(1)} MB</strong> · Ready to queue`
      : 'MP4, MOV, AVI up to 1GB<br>Walk slowly around your subject. 30–90 seconds works best.';
    submitBtn.disabled = !selectedFile;
    submitLabel.textContent = selectedFile ? 'Upload and queue' : 'Select a video to start';
  }
};

function setFile(file) {
  selectedFile = null;
  document.getElementById('submitBtn').disabled = true;
  const sourceInput = document.getElementById('fileInput');
  if (sourceInput) sourceInput.value = '';
  const reject = message => {
    window.setUploadMode(currentUploadMode);
    return showMsg(message, true);
  };
  const isPly = file.name.match(/\.(ply|nif|splat)$/i);
  const isLidar = file.name.match(/\.(las|xyz|csv|txt)$/i);
  if (currentUploadMode === 'ply') {
    if (!isPly) return reject('Please select a .splat, .ply or .nif file in direct-import mode.');
    if (/\.(splat|ply)$/i.test(file.name) && file.size > 200 * 1024 * 1024) return reject('Browser .splat/.ply → NIF conversion is limited to 200MB to protect device memory.');
    if (file.size > 500 * 1024 * 1024) return reject('This file is larger than the 500MB direct-import limit.');
  } else if (currentUploadMode === 'lidar') {
    if (!isLidar) return reject('Choose an uncompressed .las, .xyz, .csv, or .txt point cloud.');
    if (file.size > 100 * 1024 * 1024) return reject('LiDAR uploads are limited to 100MB for browser conversion.');
  } else {
    if (isPly || isLidar || !file.type.startsWith('video/')) {
      return reject(isPly ? 'Switch to Upload .ply directly to import this file.' : 'Please select a video file.');
    }
    if (file.size > 1024 * 1024 * 1024) {
      return reject('Keep uploads under 1GB for the current flow.');
    }
  }
  selectedFile = file;
  document.getElementById('uploadIcon').textContent = '✅';
  document.getElementById('uploadTitle').textContent = file.name;
  document.getElementById('uploadSub').innerHTML = `<strong>${(file.size / 1024 / 1024).toFixed(1)} MB</strong> · ${currentUploadMode === 'lidar' ? 'LiDAR ready to convert and open' : currentUploadMode === 'ply' ? 'PLY ready to open' : 'Ready to queue'}`;
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('submitLabel').textContent = currentUploadMode === 'lidar' ? 'Upload LiDAR & open in Studio' : currentUploadMode === 'ply' ? 'Upload & open in Studio' : 'Upload and queue';
  showMsg('File selected. Ready to upload.', false);
}

function setFiles(fileList) {
  const files = Array.from(fileList).filter(f =>
    ['image/jpeg', 'image/png'].includes(f.type) || /\.(jpe?g|png)$/i.test(f.name)
  );
  const sourceInput = document.getElementById('fileInput');
  if (sourceInput) sourceInput.value = '';
  selectedFiles = [];
  selectedFile = null;
  document.getElementById('submitBtn').disabled = true;
  if (!files.length) { window.setUploadMode('photos'); return showMsg('Please select image files (JPG/PNG).', true); }
  if (files.length < 3) { window.setUploadMode('photos'); return showMsg('Select at least 3 photos, taken from different angles around the subject, for real 3D reconstruction.', true); }
  if (files.length > 300) { window.setUploadMode('photos'); return showMsg('300 photos max per capture — trim your selection.', true); }
  const totalMb = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;
  if (totalMb > 800) { window.setUploadMode('photos'); return showMsg('Total size is too large (>800MB). Choose fewer or smaller photos.', true); }

  selectedFiles = files;
  selectedFile = null;
  document.getElementById('uploadIcon').textContent = '✅';
  document.getElementById('uploadTitle').textContent = `${files.length} photos selected`;
  document.getElementById('uploadSub').innerHTML = `<strong>${totalMb.toFixed(1)} MB total</strong> · Ready to queue`;
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('submitLabel').textContent = 'Upload and queue';
  showMsg(`${files.length} photos selected. Walk around the subject in order for best results.`, false);
}

function showMsg(text, isError = false) {
  const el = document.getElementById('msgBox');
  el.style.display = 'block';
  el.innerHTML = text;
  el.style.borderColor = isError ? 'rgba(255,77,77,.3)' : 'rgba(200,255,0,.25)';
  el.style.color = isError ? '#ff9d9d' : '#C8FF00';
  el.style.background = isError ? 'rgba(255,77,77,.08)' : 'rgba(200,255,0,.05)';
}

document.getElementById('tagInput').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ',') && e.target.value.trim()) {
    e.preventDefault();
    addTag(e.target.value.trim().replace(/,/g, '').replace(/\s+/g, '_').toLowerCase());
    e.target.value = '';
  }
  if (e.key === 'Backspace' && !e.target.value && tags.length) {
    tags.pop();
    renderTags();
  }
});

function addTag(tag) {
  if (tags.includes(tag) || tags.length >= 10) return;
  tags.push(tag);
  renderTags();
}
window.removeTag = i => { tags.splice(i, 1); renderTags(); };

function renderTags() {
  const wrap = document.getElementById('tagsWrap');
  wrap.querySelectorAll('.tag-pill').forEach(t => t.remove());
  const input = document.getElementById('tagInput');
  tags.forEach((tag, i) => {
    const pill = document.createElement('div');
    pill.className = 'tag-pill';
    pill.style.cssText = 'padding:6px 10px;border-radius:999px;background:rgba(200,255,0,.08);border:1px solid rgba(200,255,0,.2);font-size:12px;';
    pill.innerHTML = `#${tag} <span style="cursor:pointer;opacity:.7" onclick="removeTag(${i})">×</span>`;
    wrap.insertBefore(pill, input);
  });
}

window.selectVis = function(el, v) {
  document.querySelectorAll('.vis-option').forEach(o => {
    o.style.background = 'rgba(255,255,255,.06)';
    o.style.borderColor = 'rgba(255,255,255,.10)';
    o.style.color = '#FAFAFA';
  });
  el.style.background = 'rgba(200,255,0,.08)';
  el.style.borderColor = '#C8FF00';
  el.style.color = '#C8FF00';
  visibility = v;
};

window.toggleMono = function(type) {
  if (type === 'sale') {
    saleEnabled = !saleEnabled;
    document.getElementById('saleToggle').style.background = saleEnabled ? '#C8FF00' : 'rgba(255,255,255,.14)';
    document.getElementById('priceField').style.display = saleEnabled ? 'block' : 'none';
  } else {
    printEnabled = !printEnabled;
    document.getElementById('printToggle').style.background = printEnabled ? '#C8FF00' : 'rgba(255,255,255,.14)';
  }
};

// Calibration marker / product-verification section — plain checkbox
// show/hide, no fancy toggle styling needed since these are optional
// power-user fields, not primary actions.
document.getElementById('calibMarkerUsed')?.addEventListener('change', (e) => {
  document.getElementById('calibMarkerSizeWrap').style.display = e.target.checked ? 'block' : 'none';
});
document.getElementById('verifyAgainstRef')?.addEventListener('change', (e) => {
  document.getElementById('verifyRefWrap').style.display = e.target.checked ? 'block' : 'none';
});

/**
 * Reads the optional calibration-marker and product-verification form
 * fields, uploads the reference mesh to R2 if one was supplied, and
 * returns the meta fields pipeline.py's estimate_scale()/verify.py already
 * know how to consume. Both features are additive — an empty return object
 * changes nothing about the existing capture flow.
 *
 * meta.calibration_marker_size_m  → estimate_scale()'s ArUco path
 * meta.verify_reference_r2_key    → gates verify_against_reference() in
 *                                    pipeline.py's run(); absence = skipped,
 *                                    same as today.
 */
async function buildCalibVerifyMeta(userId) {
  const meta = {};

  const markerUsed = document.getElementById('calibMarkerUsed')?.checked;
  if (markerUsed) {
    const cm = parseFloat(document.getElementById('calibMarkerSizeCm')?.value);
    if (cm > 0) meta.calibration_marker_size_m = cm / 100;
  }

  const wantsVerify = document.getElementById('verifyAgainstRef')?.checked;
  const refFile = document.getElementById('verifyRefFile')?.files?.[0];
  if (wantsVerify && refFile) {
    const safeName = refFile.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    const refPath = `verify-refs/${userId}/${Date.now()}_${safeName}`;
    const { fileKey, error: refErr } = await r2.from('nif-files').upload(refPath, refFile, {
      contentType: 'application/octet-stream',
    });
    if (refErr) {
      // Non-fatal — verification is an optional add-on to the capture, not
      // a reason to fail the whole upload. Let the main capture proceed.
      console.warn('[FUMOCA] Reference mesh upload failed, continuing without verification:', refErr.message);
    } else {
      meta.verify_reference_r2_key = fileKey || refPath;
      const tol = parseFloat(document.getElementById('verifyToleranceMm')?.value);
      meta.verify_tolerance_mm = tol > 0 ? tol : 2.0;
    }
  }

  return meta;
}

function setStep(id, state) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = state === 'active' ? 'rgba(123,47,255,.4)' : state === 'done' ? 'rgba(200,255,0,.25)' : 'rgba(255,255,255,.10)';
  el.style.background = state === 'active' ? 'rgba(123,47,255,.08)' : state === 'done' ? 'rgba(200,255,0,.05)' : 'rgba(255,255,255,.03)';
}

function setProgress(pct, label) {
  document.getElementById('progressSection').style.display = 'block';
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPct').textContent = pct + '%';
  document.getElementById('progressLabel').textContent = label;
}

function storageFixHtml() {
  return `Storage setup still needs attention.<br><br><strong>Verify that <code>supabase_storage_policies.sql</code> was run in the same Supabase project this app is using, then hard refresh and retry.</strong><br><br>Required buckets: <code>nif-videos</code>, <code>nif-files</code>, <code>thumbnails</code>, <code>avatars</code>.`;
}

function humanizeStorageError(errorLike) {
  const msg = String(errorLike?.message || errorLike?.error_description || errorLike?.details || errorLike || '');
  const lower = msg.toLowerCase();
  if (lower.includes('row-level security')) return 'Storage upload blocked by Supabase RLS. Confirm the signed-in user is uploading to <code>nif-videos</code> under their own user folder, then retry.';
  if (lower.includes('jwt') || lower.includes('unauthorized') || lower.includes('auth')) return 'Your session is not valid for upload right now. Sign out, sign back in, then retry.';
  if (lower.includes('timed out')) return 'Upload timed out. Check your network or try a shorter clip first.';
  if (lower.includes('bucket') && lower.includes('not')) return storageFixHtml();
  if (lower.includes('schema cache') || lower.includes('column')) return 'Your frontend and database schema are out of sync. Run the latest SQL repair patch, redeploy the updated upload page, then retry.';
  return msg || 'Upload failed. Check the browser console for the raw Supabase error.';
}

async function uploadSingleBucket(fileName, file, _accessToken) {
  // ── R2 direct upload (replaces Supabase TUS resumable upload) ──────────────
  // For large video files we stream directly to R2 via the worker presign flow.
  setProgress(10, 'Uploading source video...');

  const { publicUrl, error } = await r2
    .from('nif-videos')
    .upload(fileName, file, {
      contentType: file?.type || 'video/mp4',
      onProgress: (pct) => {
        // Map raw byte progress (0-100%) into this stage's 10-34% band so the
        // bar keeps moving during the transfer instead of parking at 10%.
        setProgress(10 + Math.round((pct / 100) * 24), `Uploading source video... ${pct}%`);
      },
    });

  if (error) throw new Error('R2 video upload failed: ' + error.message);

  // Store publicUrl so callers can retrieve it
  uploadSingleBucket._lastPublicUrl = publicUrl;
  setProgress(34, 'Upload complete.');
  return { path: fileName, publicUrl };
}

function baseNifPayload(user, title, desc, category, price) {
  return {
    user_id: user.id,
    title,
    description: desc || null,
    category,
    tags,
    visibility,
    monetize_sale: saleEnabled,
    price_zar: saleEnabled ? price : null,
    monetize_print: printEnabled,
    status: 'queued',
    processing_stage: 'queued',
    processing_progress: 0
  };
}

async function createExternalNif(user, title, desc, category, price) {
  const externalNifUrl = document.getElementById('externalNifUrl').value.trim();
  const thumbnailUrl = document.getElementById('thumbnailUrl').value.trim() || uploadedThumbnail?.publicUrl;
  const previewVideoUrl = document.getElementById('previewVideoUrl').value.trim();
  const providerName = document.getElementById('providerName').value.trim();

  if (!externalNifUrl) throw new Error('Add the interactive nif URL for the external provider.');
  let parsedNifUrl;
  try { parsedNifUrl = new URL(externalNifUrl); } catch { throw new Error('Enter a valid interactive scene URL.'); }
  if (!['http:', 'https:'].includes(parsedNifUrl.protocol)) throw new Error('The interactive scene URL must use HTTP or HTTPS.');

  setProgress(35, 'Publishing finished nif...');
  setStep('step-upload', 'done');
  setStep('step-live', 'active');

  const payload = {
    ...baseNifPayload(user, title, desc, category, price),
    status: 'done',
    processing_stage: 'published',
    processing_progress: 100,
    processing_completed_at: new Date().toISOString(),
    nif_url: externalNifUrl,
    external_nif_url: externalNifUrl,
    thumbnail_url: thumbnailUrl || null,
    preview_video_url: previewVideoUrl || null,
    provider_name: providerName || 'External provider',
    source_type: 'external'
  };

  const { data: nif, error } = await supabase.from('nif_files').insert([payload]).select().single();
  if (error) throw error;

  setProgress(100, 'Published successfully');
  showMsg(`Finished nif published. Open it <a href="viewer.html?nifId=${nif.id}" style="color:#fff;text-decoration:underline;">here</a>.`, false);
  document.getElementById('submitLabel').textContent = 'Published';
}

function captureMetadata(title, desc, calibration = {}) {
  return {
    title, description: desc, tags, visibility,
    monetize_sale: saleEnabled,
    price_zar: saleEnabled ? (parseFloat(document.getElementById('nifPrice').value) || 0) : null,
    monetize_print: printEnabled,
    ...calibration,
  };
}

window.handleSubmit = async function() {
  const title = document.getElementById('nifTitle').value.trim();
  const desc = document.getElementById('nifDesc').value.trim();
  const category = document.getElementById('nifCategory').value || 'other';
  const price = saleEnabled ? (parseFloat(document.getElementById('nifPrice').value) || 0) : null;
  if (!title) return showMsg('Please add a title.', true);
  if (!selectedThumbnail && !(currentUploadMode === 'external' && document.getElementById('thumbnailUrl').value.trim())) {
    return showMsg('Choose a thumbnail image for this upload.', true);
  }
  if (currentUploadMode === 'pipeline' && !selectedFile) return showMsg('Please select a video file first.', true);
  if (currentUploadMode === 'photos' && selectedFiles.length < 3) return showMsg('Select at least 3 photos first.', true);
  if (currentUploadMode === 'ply' && !selectedFile) return showMsg('Please select a .splat, .ply or .nif file first.', true);
  if (currentUploadMode === 'lidar' && !selectedFile) return showMsg('Please select a LiDAR point cloud first.', true);

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  document.getElementById('submitLabel').textContent = currentUploadMode === 'external' ? 'Publishing...' : 'Uploading...';
  setStep('step-upload', 'active');
  setProgress(10, currentUploadMode === 'external' ? 'Preparing publish...' : 'Uploading source...');
  showMsg(currentUploadMode === 'external' ? 'Saving finished nif...' : 'Uploading...', false);

  try {
    uploadedThumbnail = null;
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      window.location.href = 'login.html';
      return;
    }

    if (selectedThumbnail) {
      const ext = selectedThumbnail.name.match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase() || '.jpg';
      const thumbPath = `thumbnails/${user.id}/${Date.now()}${ext}`;
      const { publicUrl, fileKey, error: thumbError } = await r2.from('nif-files').upload(thumbPath, selectedThumbnail, {
        contentType: selectedThumbnail.type || 'image/jpeg'
      });
      if (thumbError || !fileKey) throw new Error('Thumbnail upload failed: ' + (thumbError?.message || 'no file key returned'));
      uploadedThumbnail = { fileKey, publicUrl };
    }

    if (currentUploadMode === 'external') {
      await createExternalNif(user, title, desc, category, price);
      return;
    }

    // ── LiDAR point clouds become a portable PLY and open directly in Studio ──
    if (currentUploadMode === 'lidar') {
      setProgress(18, 'Reading LiDAR points...');
      const { importPointCloud, downsample, encodePointCloudPLY } = await import('./lidar-import.js');
      const cloud = downsample(await importPointCloud(selectedFile), 500_000);
      const plyBytes = encodePointCloudPLY(cloud);
      const plyBlob = new Blob([plyBytes], { type: 'model/x-ply' });
      const sourceBase = selectedFile.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '') || 'lidar';
      const sourceExtension = (selectedFile.name.match(/\.[a-z0-9]+$/i)?.[0] || '.bin').toLowerCase();
      const sourcePath = `${user.id}/${Date.now()}_${sourceBase}_source${sourceExtension}`;
      setProgress(28, 'Preserving original LiDAR capture...');
      const { publicUrl: sourceUrl, fileKey: sourceFileKey, error: sourceUploadError } = await r2.from('nif-files').upload(sourcePath, selectedFile, {
        contentType: selectedFile.type || 'application/octet-stream',
        onProgress: pct => setProgress(28 + Math.round(pct * 0.06), `Preserving original capture... ${pct}%`),
      });
      if (sourceUploadError || !sourceFileKey || !sourceUrl) throw new Error('Original LiDAR capture could not be preserved: ' + (sourceUploadError?.message || 'storage did not return a file URL'));
      const fileKeyPath = `${user.id}/${Date.now()}_${sourceBase}.ply`;
      setProgress(35, `Uploading converted PLY (${(plyBlob.size / 1048576).toFixed(1)} MB)...`);
      const { publicUrl, fileKey, error: uploadError } = await r2.from('nif-files').upload(fileKeyPath, plyBlob, {
        contentType: 'model/x-ply',
        onProgress: pct => setProgress(35 + Math.round(pct * 0.35), `Uploading LiDAR point cloud... ${pct}%`),
      });
      if (uploadError || !fileKey || !publicUrl) throw new Error('LiDAR upload failed: ' + (uploadError?.message || 'storage did not return a file URL'));

      setProgress(75, 'Saving LiDAR scene...');
      const sceneUrl = `edit.html?file=${encodeURIComponent(publicUrl)}&nifId=NEW_RECORD&live=true`;
      const { data: nif, error: dbErr } = await supabase.from('nif_files').insert([{
        user_id: user.id,
        title,
        description: desc || null,
        vertical: category || 'other',
        r2_key: fileKey,
        file_size: plyBlob.size,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        thumbnail_url: uploadedThumbnail.publicUrl,
        meta: {
          source_type: 'direct_lidar',
          source_filename: selectedFile.name,
          source_format: cloud.source,
          source_capture: {
            public_url: sourceUrl,
            r2_key: sourceFileKey,
            filename: selectedFile.name,
            format: cloud.source,
            byte_size: selectedFile.size,
            point_count: cloud.sourcePointCount || cloud.count,
          },
          point_count: cloud.count,
          source_point_count: cloud.sourcePointCount || cloud.count,
          nif_url: publicUrl,
          output_url: publicUrl,
          status: 'done',
          processing_stage: 'published',
          processing_progress: 100,
          tags,
          visibility,
          monetize_sale: saleEnabled,
          price_zar: saleEnabled ? price : null,
          monetize_print: printEnabled,
          thumbnail_r2_key: uploadedThumbnail.fileKey,
        },
      }]).select().single();
      if (dbErr) throw dbErr;

      const studioUrl = sceneUrl.replace('NEW_RECORD', encodeURIComponent(nif.id));
      setProgress(100, 'LiDAR scene ready in Studio.');
      setStep('step-upload', 'done'); setStep('step-live', 'done');
      showMsg(`LiDAR cloud converted to PLY and saved. <a href="${studioUrl}" style="color:#0ef;text-decoration:underline">Open in Studio →</a>`, false);
      const submitBtn = document.getElementById('submitBtn');
      submitBtn.textContent = 'Open in Studio';
      submitBtn.disabled = false;
      submitBtn.onclick = () => { window.location.href = studioUrl; };
      return;
    }

    // ── Multi-photo capture (real multi-view reconstruction, no video) ──
    if (currentUploadMode === 'photos') {
      setProgress(20, 'Bundling photos…');
      const { buildStoreZipFromFiles } = await import('./zip-writer.js');
      const zipBytes = await buildStoreZipFromFiles(selectedFiles);
      const zipBlob = new Blob([zipBytes], { type: 'application/zip' });

      setProgress(45, `Uploading ${(zipBlob.size / 1024 / 1024).toFixed(1)} MB…`);
      const zipPath = `raw/${user.id}/${Date.now()}_burst.zip`;
      const { fileKey, error: r2Err } = await r2
        .from('nif-videos')
        .upload(zipPath, zipBlob, {
          contentType: 'application/zip',
          onProgress: (pct) => {
            setProgress(45 + Math.round((pct / 100) * 25), `Uploading ${(zipBlob.size / 1024 / 1024).toFixed(1)} MB… ${pct}%`);
          },
        });
      if (r2Err) throw new Error('R2 upload failed — ' + r2Err.message);

      setStep('step-upload', 'done');
      setStep('step-frames', 'active');
      setProgress(70, 'Queueing reconstruction job…');

      const calibVerifyMeta = await buildCalibVerifyMeta(user.id);

      // reconstruction_jobs is the real, live table (confirmed against
      // production) — the GPU worker picks up capture_mode:'burst' jobs
      // and unzips raw_r2_key before frame extraction (see pipeline.py's
      // 'burst' branch, which already existed but was unreachable until
      // this upload path could actually produce a zipped raw capture).
      const { data: job, error: jobError } = await supabase.from('reconstruction_jobs').insert({
        user_id: user.id,
        status: 'queued',
        progress: 0,
        vertical: category || 'generic',
        capture_mode: 'burst',
        raw_r2_key: fileKey,
        meta: { ...captureMetadata(title, desc, calibVerifyMeta), photo_count: selectedFiles.length, thumbnail_r2_key: uploadedThumbnail.fileKey, capture_thumbnail_r2_key: uploadedThumbnail.fileKey, source_r2_key: fileKey, source_capture: { r2_key: fileKey, filename: `${title || 'photo-capture'}.zip`, format: 'photo_zip', photo_count: selectedFiles.length, created_at: new Date().toISOString() } },
      }).select().single();
      if (jobError) throw jobError;

      setStep('step-frames', 'done');
      setStep('step-train', 'active');
      setProgress(100, 'Queued successfully.');
      showMsg(`${selectedFiles.length} photos uploaded and queued for reconstruction. Job id: ${job.id}`, false);
      document.getElementById('submitLabel').textContent = 'Queued';
      return;
    }

    // ── Direct Gaussian / point-cloud import ───────────────────────────────
    if (currentUploadMode === 'ply') {
      if (!selectedFile) throw new Error('Select a .splat, .ply or .nif file.');
      const ext = selectedFile.name.split('.').pop().toLowerCase();
      const isSplat = ext === 'splat';
      const isNif = ext === 'nif';
      const stamp = Date.now();
      const safeName = selectedFile.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
      const sourcePath = `${user.id}/sources/${stamp}_${safeName}`;
      let outputBuffer = null;
      let gaussianCount = null;
      // Mirror conversion provenance into both the NIF META chunk and the
      // database record so Studio/library consumers can disclose lossy imports.
      let conversionDetails = null;
      let outputName = selectedFile.name;
      let outputKey = sourcePath;
      let outputUrl = '';
      let sourceKey = sourcePath;
      let sourceUrl = '';

      if (isSplat) {
        setProgress(15, 'Reading existing Gaussian splat (no GPU required)…');
        const sourceBuffer = await selectedFile.arrayBuffer();
        if (!sourceBuffer.byteLength || sourceBuffer.byteLength % 32 !== 0) {
          throw new Error('Invalid .splat file: expected complete 32-byte Gaussian rows.');
        }
        gaussianCount = sourceBuffer.byteLength / 32;
        if (!gaussianCount) throw new Error('The .splat file contains no Gaussian rows.');
        setProgress(25, 'Packing Gaussian rows into FUMOCA NIF…');
        const aliveIndices = new Uint32Array(gaussianCount);
        for (let i = 0; i < gaussianCount; i++) aliveIndices[i] = i;
        conversionDetails = {
          engine: 'fumoca-nif-format',
          mode: 'quantized-geometry',
          gpu_required: false,
          preserved_attributes: ['position', 'scale', 'rotation', 'RGBA/opacity'],
          discarded_attributes: [],
          quality_flags: [],
          created_at: new Date().toISOString(),
        };
        outputBuffer = encodeNif({
          sourceBuffer: new Uint8Array(sourceBuffer),
          aliveIndices,
          rowSize: 32,
          vertical: category || 'generic',
          meta: {
            title: title || selectedFile.name.replace(/\.splat$/i, ''),
            description: desc || '',
            source_format: 'splat',
            conversion: conversionDetails,
          },
        });
        outputName = selectedFile.name.replace(/\.splat$/i, '') + '.nif';
      } else if (ext === 'ply') {
        setProgress(15, 'Parsing PLY geometry (CPU/browser route)…');
        const parsedGeometry = new PLYLoader().parse(await selectedFile.arrayBuffer());
        const posAttr = parsedGeometry.getAttribute('position');
        if (!posAttr || !posAttr.count) throw new Error('PLY contains no vertex positions.');
        const count = posAttr.count;
        const attr = name => parsedGeometry.getAttribute(name);
        const sx = attr('scale_0'), sy = attr('scale_1'), sz = attr('scale_2');
        const opacityAttr = attr('opacity');
        const dc0 = attr('f_dc_0'), dc1 = attr('f_dc_1'), dc2 = attr('f_dc_2');
        const rot0 = attr('rot_0'), rot1 = attr('rot_1'), rot2 = attr('rot_2'), rot3 = attr('rot_3');
        const colorAttr = parsedGeometry.getAttribute('color');
        const isGaussianPly = !!(sx && sy && sz && opacityAttr && dc0 && dc1 && dc2 && rot0 && rot1 && rot2 && rot3);
        const plyAttributeNames = Object.keys(parsedGeometry.attributes || {});
        const higherOrderShAttributes = plyAttributeNames.filter(name => /^f_rest_\d+$/.test(name));
        const higherOrderShCount = higherOrderShAttributes.length;
        const shOrderCandidate = higherOrderShCount % 3 === 0
          ? Math.round(Math.sqrt(higherOrderShCount / 3 + 1) - 1)
          : -1;
        const detectedShDegree = shOrderCandidate >= 1 &&
          3 * ((shOrderCandidate + 1) ** 2 - 1) === higherOrderShCount
          ? shOrderCandidate
          : 0;
        setProgress(25, isGaussianPly ? 'Converting Gaussian PLY attributes…' : 'Converting point-cloud PLY to NIF…');

        if (isGaussianPly) {
          const rows = new Uint8Array(count * 32);
          const view = new DataView(rows.buffer);
          const clampByte = value => Math.max(0, Math.min(255, Math.round(value)));
          const sigmoid = value => 1 / (1 + Math.exp(-value));
          const rgb = value => clampByte((value * 0.2820947918 + 0.5) * 255);
          for (let i = 0; i < count; i++) {
            const o = i * 32;
            view.setFloat32(o, posAttr.getX(i), true);
            view.setFloat32(o + 4, posAttr.getY(i), true);
            view.setFloat32(o + 8, posAttr.getZ(i), true);
            view.setFloat32(o + 12, Math.exp(sx.getX(i)), true);
            view.setFloat32(o + 16, Math.exp(sy.getX(i)), true);
            view.setFloat32(o + 20, Math.exp(sz.getX(i)), true);
            rows[o + 24] = rgb(dc0.getX(i));
            rows[o + 25] = rgb(dc1.getX(i));
            rows[o + 26] = rgb(dc2.getX(i));
            rows[o + 27] = clampByte(sigmoid(opacityAttr.getX(i)) * 255);
            for (const [j, a] of [[28,rot0],[29,rot1],[30,rot2],[31,rot3]]) {
              rows[o + j] = clampByte((Math.max(-1, Math.min(1, a.getX(i))) + 1) * 127.5);
            }
          }
          const aliveIndices = new Uint32Array(count);
          for (let i = 0; i < count; i++) aliveIndices[i] = i;
          conversionDetails = {
            engine: 'fumoca-nif-format',
            gpu_required: false,
            attribute_mapping: 'xyz/scale/f_dc/opacity/rotation',
            preserved_attributes: ['position', 'scale', 'rotation', 'opacity', 'DC colour'],
            sh_degree_detected: detectedShDegree,
            discarded_attributes: higherOrderShCount
              ? ['higher-order spherical-harmonic colour coefficients (f_rest_*)']
              : [],
            quality_flags: higherOrderShCount
              ? ['higher_order_sh_discarded_colour_approximation']
              : [],
            created_at: new Date().toISOString(),
          };
          outputBuffer = encodeNif({
            sourceBuffer: rows, aliveIndices, rowSize: 32, vertical: category || 'generic',
            meta: { title: title || selectedFile.name.replace(/\.ply$/i, ''), description: desc || '', source_format: 'gaussian_ply', conversion: conversionDetails },
          });
        } else {
          const positions = new Float32Array(count * 3);
          const colors01 = new Float32Array(count * 3);
          const opacities01 = new Float32Array(count);
          const opacity = opacityAttr;
          for (let i = 0; i < count; i++) {
            positions[i*3] = posAttr.getX(i); positions[i*3+1] = posAttr.getY(i); positions[i*3+2] = posAttr.getZ(i);
            if (colorAttr) {
              const max = Math.max(colorAttr.getX(i), colorAttr.getY(i), colorAttr.getZ(i)) > 1 ? 255 : 1;
              colors01[i*3] = colorAttr.getX(i) / max;
              colors01[i*3+1] = colorAttr.getY(i) / max;
              colors01[i*3+2] = colorAttr.getZ(i) / max;
            } else { colors01[i*3] = 0.8; colors01[i*3+1] = 0.8; colors01[i*3+2] = 0.8; }
            const rawOpacity = opacity ? opacity.getX(i) : 1;
            opacities01[i] = rawOpacity < 0 || rawOpacity > 1 ? 1 / (1 + Math.exp(-rawOpacity)) : rawOpacity;
          }
          conversionDetails = {
            engine: 'fumoca-nif-format',
            gpu_required: false,
            geometry_quality: 'isotropic-points; mesh reconstruction not run',
            preserved_attributes: ['position', ...(colorAttr ? ['RGB colour'] : []), ...(opacity ? ['opacity'] : [])],
            discarded_attributes: [],
            quality_flags: ['point_cloud_not_gaussian', 'mesh_reconstruction_not_run'],
            created_at: new Date().toISOString(),
          };
          outputBuffer = encodeNif({
            positions, colors01, opacities01, vertical: category || 'generic',
            meta: { title: title || selectedFile.name.replace(/\.ply$/i, ''), description: desc || '', source_format: 'point_cloud_ply', conversion: conversionDetails },
          });
        }
        gaussianCount = count;
        outputName = selectedFile.name.replace(/\.ply$/i, '') + '.nif';
      }

      setProgress(35, 'Preserving original source in R2…');
      const { publicUrl: uploadedSourceUrl, fileKey: uploadedSourceKey, error: sourceErr } = await r2
        .from('nif-files')
        .upload(sourcePath, selectedFile, {
          contentType: isSplat ? 'application/octet-stream' : ext === 'ply' ? 'model/x-ply' : 'application/octet-stream',
          onProgress: (pct) => setProgress(35 + Math.round(pct * 0.2), `Uploading original source… ${pct}%`),
        });
      if (sourceErr) throw new Error('Source upload failed: ' + sourceErr.message);
      sourceUrl = uploadedSourceUrl || '';
      sourceKey = uploadedSourceKey || sourcePath;

      if (isSplat || ext === 'ply') {
        const outputPath = `${user.id}/converted/${stamp}_${outputName}`;
        setProgress(60, 'Uploading converted NIF…');
        const { publicUrl, fileKey, error: outputErr } = await r2
          .from('nif-files')
          .upload(outputPath, new Blob([outputBuffer], { type: 'application/octet-stream' }), {
            contentType: 'application/octet-stream',
            onProgress: (pct) => setProgress(60 + Math.round(pct * 0.2), `Uploading NIF… ${pct}%`),
          });
        if (outputErr) throw new Error('NIF upload failed: ' + outputErr.message);
        outputUrl = publicUrl || '';
        outputKey = fileKey || outputPath;
      } else {
        outputUrl = sourceUrl;
        outputKey = sourceKey;
      }

      setProgress(85, 'Registering asset and provenance…');
      const { data: nif, error: dbErr } = await supabase.from('nif_files').insert([{
        user_id: user.id,
        title: title || selectedFile.name.replace(/\.(splat|ply|nif)$/i, ''),
        description: desc || null,
        vertical: category || 'generic',
        r2_key: outputKey,
        file_size: outputBuffer ? outputBuffer.byteLength : selectedFile.size,
        gaussian_count: gaussianCount,
        is_public: false,
        meta: {
          source_type: isSplat ? 'splat_to_nif' : ext === 'ply' ? 'ply_to_nif' : 'direct_nif',
          source_filename: selectedFile.name,
          source_capture: { r2_key: sourceKey, public_url: sourceUrl, filename: selectedFile.name, format: ext, byte_size: selectedFile.size },
          source_r2_key: sourceKey,
          source_public_url: sourceUrl,
          output_format: (isSplat || ext === 'ply') ? 'nif' : ext,
          output_r2_key: outputKey,
          output_public_url: outputUrl,
          conversion: outputBuffer ? {
            ...(conversionDetails || {}),
            input_bytes: selectedFile.size,
            output_bytes: outputBuffer.byteLength,
            gaussian_count: gaussianCount,
            source_format: ext,
          } : null,
          status: 'done',
          processing_stage: (isSplat || ext === 'ply') ? 'converted' : 'imported',
          processing_progress: 100,
          tags,
          visibility,
          thumbnail_r2_key: uploadedThumbnail.fileKey,
        },
        thumbnail_url: uploadedThumbnail.publicUrl,
      }]).select().single();
      if (dbErr) throw dbErr;

      setProgress(100, (isSplat || ext === 'ply') ? 'NIF conversion complete.' : 'NIF imported.');
      setStep('step-upload', 'done');
      setStep('step-live', 'done');
      const message = isSplat
        ? `Converted ${gaussianCount} Gaussian rows into a NIF derivative. Original .splat preserved. `
        : ext === 'ply' ? `Converted ${gaussianCount} PLY vertices into a NIF derivative. Original PLY preserved. ` : 'NIF imported. ';
      showMsg(message + `Asset id: ${nif.id}. Open it from your library.`, false);
      document.getElementById('submitLabel').textContent = 'Imported';
      document.getElementById('submitBtn').textContent = 'Imported';
      return;
    }
    // reconstruction_jobs is the real, live table — confirmed against the
    // actual production Supabase project in an earlier session (there was a
    // stale doubt about whether nif_files/reconstruction_jobs existed there;
    // they do). No nif_files row yet at this point — there's no processed
    // NIF at upload time; pipeline.py's own _register() creates that once
    // processing completes.
    const { data: job, error: jobError } = await supabase.from('reconstruction_jobs').insert({
      user_id: user.id,
      status: 'queued',
      progress: 0,
      vertical: category || 'generic',
      capture_mode: 'video',
      raw_r2_key: filePath,
      meta: { ...captureMetadata(title, desc, calibVerifyMeta), video_filename: selectedFile.name, thumbnail_r2_key: uploadedThumbnail.fileKey, capture_thumbnail_r2_key: uploadedThumbnail.fileKey, source_r2_key: filePath, source_capture: { r2_key: filePath, filename: selectedFile.name, format: selectedFile.type || 'video', byte_size: selectedFile.size, created_at: new Date().toISOString() } },
    }).select().single();
    if (jobError) throw jobError;

    setStep('step-frames', 'done');
    setStep('step-train', 'active');
    setProgress(70, 'Queued for processing...');
    setProgress(100, 'Queued successfully. Open Kaggle worker to process this job.');
    showMsg(`Upload complete. Your video is queued for reconstruction. Job id: ${job.id}. Check your dashboard once processing completes.`, false);
    document.getElementById('submitLabel').textContent = 'Queued';
  } catch (error) {
    console.error('[FUMOCA] upload pipeline raw error:', error);
    showMsg(humanizeStorageError(error), true);
    setProgress(0, 'Upload failed');
    btn.disabled = false;
    document.getElementById('submitLabel').textContent = currentUploadMode === 'external' ? 'Retry publish' : 'Retry upload';
    setStep('step-upload', 'idle');
  }
};
