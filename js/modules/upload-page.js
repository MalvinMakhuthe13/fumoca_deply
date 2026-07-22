import { supabase } from '../supabaseClient.js';
import { runtimeConfig } from '../runtime-config.js';
import r2 from '../r2Client.js';

const VIDEO_BUCKET = 'splat-videos';
let selectedFile = null;
let selectedFiles = []; // used only in 'photos' mode
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
  currentUploadMode = mode === 'external' ? 'external' : mode === 'ply' ? 'ply' : mode === 'photos' ? 'photos' : 'pipeline';
  window.currentUploadMode = currentUploadMode;

  const pipelineBtn = document.getElementById('modePipelineBtn');
  const photosBtn = document.getElementById('modePhotosBtn');
  const plyBtn = document.getElementById('modePlyBtn');
  const externalBtn = document.getElementById('modeExternalBtn');
  const externalFields = document.getElementById('externalFields');
  const uploadZone = document.getElementById('uploadZone');
  const submitLabel = document.getElementById('submitLabel');
  const submitBtn = document.getElementById('submitBtn');
  const fileInput = document.getElementById('fileInput');

  // Reset all buttons
  [pipelineBtn, photosBtn, plyBtn, externalBtn].filter(Boolean).forEach(btn => {
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
    if (fileInput) { fileInput.accept = 'image/*'; fileInput.multiple = true; }
    uploadZone.querySelector('#uploadIcon').textContent = selectedFiles.length ? '✅' : '📸';
    uploadZone.querySelector('#uploadTitle').textContent = selectedFiles.length
      ? `${selectedFiles.length} photos selected` : 'Drop 3+ photos here';
    uploadZone.querySelector('#uploadSub').innerHTML = selectedFiles.length
      ? `<strong>${(selectedFiles.reduce((s,f)=>s+f.size,0) / 1024 / 1024).toFixed(1)} MB total</strong> · Ready to queue`
      : 'Walk around your subject, one photo every ~15°<br>Real multi-view reconstruction — same pipeline as video, no video required.';
    submitBtn.disabled = selectedFiles.length < 3;
    submitLabel.textContent = selectedFiles.length ? 'Upload and queue' : 'Select 3+ photos to start';
  } else if (currentUploadMode === 'ply') {
    // Switch file input to accept .ply and .splat
    if (fileInput) { fileInput.accept = '.ply,.splat'; fileInput.multiple = false; }
    uploadZone.querySelector('#uploadIcon').textContent = '📂';
    uploadZone.querySelector('#uploadTitle').textContent = selectedFile ? selectedFile.name : 'Drop your .ply file here';
    uploadZone.querySelector('#uploadSub').innerHTML = selectedFile
      ? `<strong>${(selectedFile.size / 1024 / 1024).toFixed(1)} MB</strong> · PLY ready`
      : '.ply or .splat files · Full capture data preserved<br>Camera positions, colours, and Gaussian structure imported directly.';
    submitBtn.disabled = !selectedFile;
    submitLabel.textContent = selectedFile ? 'Upload & open in Studio' : 'Select a .ply file to start';
    showMsg('PLY mode — drop a .ply capture file to upload directly and open in the editor.', false);
  } else if (currentUploadMode === 'external') {
    if (fileInput) { fileInput.accept = 'video/*'; fileInput.multiple = false; }
    uploadZone.querySelector('#uploadIcon').textContent = '🧊';
    uploadZone.querySelector('#uploadTitle').textContent = 'Publish a finished splat';
    uploadZone.querySelector('#uploadSub').innerHTML = 'Paste a ready-made splat URL, thumbnail and optional teaser video.';
    submitBtn.disabled = false;
    submitLabel.textContent = 'Publish finished splat';
    showMsg('External-provider mode is ready. Paste your finished scene links below.', false);
  } else {
    if (fileInput) { fileInput.accept = 'video/*'; fileInput.multiple = false; }
    uploadZone.querySelector('#uploadIcon').textContent = selectedFile ? '✅' : '🎬';
    uploadZone.querySelector('#uploadTitle').textContent = selectedFile ? selectedFile.name : 'Drop your video here';
    uploadZone.querySelector('#uploadSub').innerHTML = selectedFile
      ? `<strong>${(selectedFile.size / 1024 / 1024).toFixed(1)} MB</strong> · Ready to queue`
      : 'MP4, MOV, AVI up to 2GB<br>Walk slowly around your subject. 30–90 seconds works best.';
    submitBtn.disabled = !selectedFile;
    submitLabel.textContent = selectedFile ? 'Upload and queue' : 'Select a video to start';
  }
};

function setFile(file) {
  const isPly = file.name.match(/\.(ply|splat)$/i);
  if (currentUploadMode === 'ply') {
    if (!isPly) return showMsg('Please select a .ply or .splat file in PLY mode.', true);
    if (file.size > 500 * 1024 * 1024) return showMsg('PLY file is very large (>500MB) — upload may be slow.', false);
  } else {
    if (!file.type.startsWith('video/') && !isPly) return showMsg('Please select a video file.', true);
    if (file.size > 1024 * 1024 * 1024) return showMsg('Keep uploads under 1GB for the current flow.', true);
  }
  selectedFile = file;
  document.getElementById('uploadIcon').textContent = '✅';
  document.getElementById('uploadTitle').textContent = file.name;
  document.getElementById('uploadSub').innerHTML = `<strong>${(file.size / 1024 / 1024).toFixed(1)} MB</strong> · Ready to queue`;
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('submitLabel').textContent = 'Upload and queue';
  showMsg('File selected. Ready to upload.', false);
}

function setFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
  if (!files.length) return showMsg('Please select image files (JPG/PNG).', true);
  if (files.length < 3) return showMsg('Select at least 3 photos, taken from different angles around the subject, for real 3D reconstruction.', true);
  if (files.length > 300) return showMsg('300 photos max per capture — trim your selection.', true);
  const totalMb = files.reduce((sum, f) => sum + f.size, 0) / 1024 / 1024;
  if (totalMb > 800) return showMsg('Total size is very large (>800MB) — upload may be slow.', false);

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
  return `Storage setup still needs attention.<br><br><strong>Verify that <code>supabase_storage_policies.sql</code> was run in the same Supabase project this app is using, then hard refresh and retry.</strong><br><br>Required buckets: <code>splat-videos</code>, <code>splat-files</code>, <code>thumbnails</code>, <code>avatars</code>.`;
}

function humanizeStorageError(errorLike) {
  const msg = String(errorLike?.message || errorLike?.error_description || errorLike?.details || errorLike || '');
  const lower = msg.toLowerCase();
  if (lower.includes('row-level security')) return 'Storage upload blocked by Supabase RLS. Confirm the signed-in user is uploading to <code>splat-videos</code> under their own user folder, then retry.';
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
    .from('splat-videos')
    .upload(fileName, file, { contentType: file?.type || 'video/mp4' });

  if (error) throw new Error('R2 video upload failed: ' + error.message);

  // Store publicUrl so callers can retrieve it
  uploadSingleBucket._lastPublicUrl = publicUrl;
  setProgress(34, 'Upload complete.');
  return { path: fileName, publicUrl };
}

function baseSplatPayload(user, title, desc, category, price) {
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

async function createExternalSplat(user, title, desc, category, price) {
  const externalSplatUrl = document.getElementById('externalSplatUrl').value.trim();
  const thumbnailUrl = document.getElementById('thumbnailUrl').value.trim();
  const previewVideoUrl = document.getElementById('previewVideoUrl').value.trim();
  const providerName = document.getElementById('providerName').value.trim();

  if (!externalSplatUrl) throw new Error('Add the interactive splat URL for the external provider.');

  setProgress(35, 'Publishing finished splat...');
  setStep('step-upload', 'done');
  setStep('step-live', 'active');

  const payload = {
    ...baseSplatPayload(user, title, desc, category, price),
    status: 'done',
    processing_stage: 'published',
    processing_progress: 100,
    processing_completed_at: new Date().toISOString(),
    splat_url: externalSplatUrl,
    external_splat_url: externalSplatUrl,
    thumbnail_url: thumbnailUrl || null,
    preview_video_url: previewVideoUrl || null,
    provider_name: providerName || 'External provider',
    source_type: 'external'
  };

  const { data: splat, error } = await supabase.from('splats').insert([payload]).select().single();
  if (error) throw error;

  setProgress(100, 'Published successfully');
  showMsg(`Finished splat published. Open it <a href="viewer.html?splatId=${splat.id}" style="color:#fff;text-decoration:underline;">here</a>.`, false);
  document.getElementById('submitLabel').textContent = 'Published';
}

window.handleSubmit = async function() {
  const title = document.getElementById('splatTitle').value.trim();
  const desc = document.getElementById('splatDesc').value.trim();
  const category = document.getElementById('splatCategory').value || 'other';
  const price = saleEnabled ? (parseFloat(document.getElementById('splatPrice').value) || 0) : null;
  if (!title) return showMsg('Please add a title.', true);
  if (currentUploadMode === 'pipeline' && !selectedFile) return showMsg('Please select a video file first.', true);
  if (currentUploadMode === 'photos' && selectedFiles.length < 3) return showMsg('Select at least 3 photos first.', true);

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  document.getElementById('submitLabel').textContent = currentUploadMode === 'external' ? 'Publishing...' : 'Uploading...';
  setStep('step-upload', 'active');
  setProgress(10, currentUploadMode === 'external' ? 'Preparing publish...' : 'Uploading source...');
  showMsg(currentUploadMode === 'external' ? 'Saving finished splat...' : 'Uploading...', false);

  try {
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      window.location.href = 'login.html';
      return;
    }

    if (currentUploadMode === 'external') {
      await createExternalSplat(user, title, desc, category, price);
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
        .from('splat-files')
        .upload(zipPath, zipBlob, { contentType: 'application/zip' });
      if (r2Err) throw new Error('R2 upload failed — ' + r2Err.message);

      setStep('step-upload', 'done');
      setStep('step-frames', 'active');
      setProgress(70, 'Queueing reconstruction job…');

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
        meta: { title, description: desc, tags, photo_count: selectedFiles.length },
      }).select().single();
      if (jobError) throw jobError;

      setStep('step-frames', 'done');
      setStep('step-train', 'active');
      setProgress(100, 'Queued successfully.');
      showMsg(`${selectedFiles.length} photos uploaded and queued for reconstruction. Job id: ${job.id}`, false);
      document.getElementById('submitLabel').textContent = 'Queued';
      return;
    }

    // ── PLY direct upload ──────────────────────────────
    if (currentUploadMode === 'ply') {
      if (!selectedFile) throw new Error('No .ply file selected');
      setProgress(20, 'Uploading .ply file...');

      const safeName = selectedFile.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
      const filePath = `${user.id}/${Date.now()}_${safeName}`;

      // Upload to R2 (replaces supabase.storage bucket fallback loop)
      const { publicUrl, error: r2Err } = await r2
        .from('splat-files')
        .upload(filePath, selectedFile, { contentType: 'model/x-ply' });
      if (r2Err) throw new Error('R2 upload failed — ' + r2Err.message);

      setProgress(60, 'Creating record...');
      const { data: splat, error: dbErr } = await supabase.from('splats').insert([{
        user_id: user.id,
        title: title || selectedFile.name,
        description: desc || '',
        category: category || 'general',
        splat_url: publicUrl,
        output_url: publicUrl,
        status: 'done',
        processing_stage: 'published',
        processing_progress: 100,
        source_type: 'direct_ply',
        must_edit_before_publish: false,
        edit_completed: true,
        created_at: new Date().toISOString(),
      }]).select().single();

      if (dbErr) throw dbErr;

      setProgress(100, 'Ready!');
      setStep('step-upload', 'done');
      setStep('step-live', 'done');
      showMsg(`PLY uploaded. <a href="edit.html?file=${encodeURIComponent(publicUrl)}&splatId=${splat.id}&live=true" style="color:#0ef;text-decoration:underline;">Open in Studio →</a>`, false);
      document.getElementById('submitLabel').textContent = 'Open in Studio';
      document.getElementById('submitBtn').textContent = 'Open in Studio';
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').onclick = () => {
        window.location.href = `edit.html?file=${encodeURIComponent(publicUrl)}&splatId=${splat.id}&live=true`;
      };
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    if (!accessToken) throw new Error('Missing signed-in session token for resumable upload. Sign in again and retry.');

    const safeName = selectedFile.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = `${user.id}/${Date.now()}_${safeName}`;
    await uploadSingleBucket(filePath, selectedFile, accessToken);

    setStep('step-upload', 'done');
    setStep('step-frames', 'active');
    setProgress(35, 'Queueing reconstruction job...');

    // reconstruction_jobs is the real, live table (confirmed against
    // production; `splats`/`processing_jobs` do not exist there). No
    // nif_files row yet — there's no processed NIF at upload time;
    // pipeline.py's own _register() creates that once processing completes.
    const { data: job, error: jobError } = await supabase.from('reconstruction_jobs').insert({
      user_id: user.id,
      status: 'queued',
      progress: 0,
      vertical: category || 'generic',
      capture_mode: 'video',
      raw_r2_key: filePath,
      meta: { title, description: desc, tags, video_filename: selectedFile.name },
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
