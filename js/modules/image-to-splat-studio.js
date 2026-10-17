/* FUMOCA Image-to-Splat Studio — client-side project preparation.
 * No source image is uploaded by this module. The JSON export is a camera plan,
 * not a trained splat or a promise of metric camera distances.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const fileInput = $('itsFiles');
  const dropzone = $('itsDropzone');
  const grid = $('itsImageGrid');
  const countLabel = $('itsFileCount');
  const clearButton = $('itsClearFiles');
  const exportButton = $('itsExportPlan');
  const exportJsonButton = $('itsExportJson');
  if (!fileInput || !dropzone || !grid || !exportButton) return;

  let files = [];
  let objectUrls = [];

  const settings = {
    count: $('itsCount'),
    sweep: $('itsSweep'),
    radius: $('itsRadius'),
    elevation: $('itsElevation'),
    fov: $('itsFov')
  };

  const outputs = {
    count: $('itsCountOut'),
    sweep: $('itsSweepOut'),
    radius: $('itsRadiusOut'),
    elevation: $('itsElevationOut'),
    fov: $('itsFovOut')
  };

  function setText(id, value) {
    if ($(id)) $(id).textContent = value;
  }

  function updateOutputs() {
    outputs.count.textContent = settings.count.value;
    outputs.sweep.textContent = settings.sweep.value + '°';
    outputs.radius.textContent = Number(settings.radius.value).toFixed(2);
    outputs.elevation.textContent = settings.elevation.value + '°';
    outputs.fov.textContent = settings.fov.value + '°';
  }

  function cleanupUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }

  function renderFiles() {
    cleanupUrls();
    grid.replaceChildren();
    countLabel.textContent = files.length + (files.length === 1 ? ' image selected' : ' images selected');
    clearButton.disabled = files.length === 0;
    exportButton.disabled = files.length === 0;
    if (exportJsonButton) exportJsonButton.disabled = files.length === 0;

    if (!files.length) {
      const empty = document.createElement('div');
      empty.className = 'its-empty';
      const glyph = document.createElement('span');
      glyph.textContent = '▧';
      const title = document.createElement('strong');
      title.textContent = 'Your source gallery will appear here';
      const hint = document.createElement('p');
      hint.textContent = 'Use authorised images from a listing or your phone.';
      empty.append(glyph, title, hint);
      grid.append(empty);
      return;
    }

    files.forEach((file) => {
      const tile = document.createElement('div');
      tile.className = 'its-image-tile';
      const img = document.createElement('img');
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      img.src = url;
      img.alt = file.name;
      const label = document.createElement('span');
      label.textContent = file.name;
      label.title = file.name;
      tile.append(img, label);
      grid.append(tile);
    });
  }

  function addFiles(list) {
    const incoming = Array.from(list || []).filter((file) => file.type.startsWith('image/'));
    const seen = new Set(files.map((file) => [file.name, file.size, file.lastModified].join(':')));
    incoming.forEach((file) => {
      const key = [file.name, file.size, file.lastModified].join(':');
      if (!seen.has(key)) {
        files.push(file);
        seen.add(key);
      }
    });
    renderFiles();
  }

  fileInput.addEventListener('change', (event) => {
    addFiles(event.target.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((type) => dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  }));
  dropzone.addEventListener('drop', (event) => addFiles(event.dataTransfer && event.dataTransfer.files));

  clearButton.addEventListener('click', () => {
    files = [];
    renderFiles();
  });

  Object.values(settings).forEach((input) => input.addEventListener('input', updateOutputs));
  document.querySelectorAll('input[name="itsMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      document.querySelectorAll('.its-mode').forEach((card) => {
        card.classList.toggle('selected', card.querySelector('input').checked);
      });
    });
  });

  $('itsResetPlan').addEventListener('click', () => {
    settings.count.value = '12';
    settings.sweep.value = '360';
    settings.radius.value = '3';
    settings.elevation.value = '5';
    settings.fov.value = '35';
    updateOutputs();
  });

  function cameraPlan() {
    const count = Number(settings.count.value);
    const sweep = Number(settings.sweep.value);
    const radius = Number(settings.radius.value);
    const elevationDeg = Number(settings.elevation.value);
    const elevation = elevationDeg * Math.PI / 180;
    const fov = Number(settings.fov.value);
    const cameras = [];

    for (let i = 0; i < count; i += 1) {
      const azimuthDeg = count === 1 ? 0 : (sweep * i / count);
      const azimuth = azimuthDeg * Math.PI / 180;
      cameras.push({
        index: i,
        azimuth_degrees: Number(azimuthDeg.toFixed(3)),
        elevation_degrees: elevationDeg,
        radius_scene_units: radius,
        field_of_view_degrees: fov,
        position_relative_to_target: {
          x: Number((radius * Math.sin(azimuth) * Math.cos(elevation)).toFixed(6)),
          y: Number((radius * Math.sin(elevation)).toFixed(6)),
          z: Number((radius * Math.cos(azimuth) * Math.cos(elevation)).toFixed(6))
        },
        target: [0, 0, 0],
        pose_source: 'synthetic_planned',
        metric_scale_verified: false
      });
    }

    const selectedMode = document.querySelector('input[name="itsMode"]:checked');
    return {
      schema: 'fumoca.image-to-splat.project.v1',
      created_at: new Date().toISOString(),
      status: 'camera_plan_only',
      source_images: files.map((file, index) => ({
        index,
        name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        last_modified: new Date(file.lastModified).toISOString(),
        provenance: 'user_selected_local_file',
        uploaded: false
      })),
      camera_plan: {
        count,
        horizontal_sweep_degrees: sweep,
        radius_scene_units: radius,
        elevation_degrees: elevationDeg,
        field_of_view_degrees: fov,
        cameras
      },
      processing_preferences: {
        mode: selectedMode ? selectedMode.value : 'reproject',
        ai_inference_enabled: selectedMode ? selectedMode.value === 'video' : false,
        retain_source_images: true,
        preserve_unseen_regions_as_unknown: true
      },
      accuracy: {
        camera_positions_are_planned: true,
        radius_is_not_a_real_world_measurement: true,
        synthetic_views_are_not_independent_observations: true,
        measurement_grade: false
      },
      integration: {
        target_engine: 'Image2Splat',
        upstream_repository: 'https://github.com/romanpillai/Image2Splat',
        note: 'This manifest does not contain image pixels and is not yet consumed by the upstream engine. A backend adapter is required for automated processing.'
      }
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  if (exportJsonButton) exportJsonButton.addEventListener('click', () => {
    if (!files.length) return;
    const blob = new Blob([JSON.stringify(cameraPlan(), null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'fumoca-image-to-splat-camera-plan.json');
  });

  exportButton.addEventListener('click', async () => {
    if (!files.length || exportButton.disabled) return;
    const originalLabel = exportButton.textContent;
    exportButton.disabled = true;
    exportButton.textContent = 'Packaging source images…';
    try {
      // Load ZIP code only after an explicit user action; no image is sent to a server.
      const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
      const zip = new JSZip();
      zip.file('fumoca-project.json', JSON.stringify(cameraPlan(), null, 2));
      const sourceFolder = zip.folder('source-images');
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || `image-${i + 1}`;
        sourceFolder.file(`${String(i + 1).padStart(3, '0')}-${safeName}`, file);
      }
      zip.file('README.txt', 'FUMOCA Image-to-Splat project package\n\nContains the original user-selected source images and a camera-plan manifest. This is an input package only; it is not a reconstructed scene, trained Gaussian splat, or verified measurement. Synthetic camera poses are planning metadata.\n');
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 3 } });
      downloadBlob(blob, 'fumoca-image-to-splat-project.zip');
      setText('itsFileCount', `${files.length} images packaged · ${(blob.size / (1024 * 1024)).toFixed(1)} MB ZIP`);
    } catch (error) {
      console.error('[FUMOCA Image-to-Splat] Package export failed', error);
      window.alert('Could not package the images. Check your connection and try again. Your files have not been uploaded.');
    } finally {
      exportButton.disabled = files.length === 0;
      exportButton.textContent = originalLabel;
    }
  });


  window.addEventListener('beforeunload', cleanupUrls);
  updateOutputs();
  renderFiles();
})();
