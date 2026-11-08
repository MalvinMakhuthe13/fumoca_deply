/**
 * FUMOCA Poster Scene Manager
 * UI for managing independently transformable composition subjects.
 */
import r2 from '../r2Client.js';
export function mountPosterSceneManager() {
  const root = document.getElementById('ptpPosterComposer');
  const api = window.FumocaPoster;
  if (!root || !api || root.querySelector('[data-fumoca-scene-manager]')) return;
  const section = document.createElement('section');
  section.dataset.fumocaSceneManager = '1';
  section.innerHTML = '<div class="ptp-poster-subtitle">3D SCENE OBJECTS</div>' +
    '<p class="ptp-poster-hint">Manage the objects in this composition. The current viewer is the primary subject. Additional published Gaussian PLY and NIF companion assets load as independent objects in the Spark viewer.</p>' +
    '<label class="ptp-poster-field">Choose from your saved NIF assets<select data-scene-asset-select><option value="">Load your saved assets first</option></select></label>' +
    '<div class="ptp-poster-actions"><button type="button" data-scene-load-assets>Load my saved NIFs</button></div>' +
    '<label class="ptp-poster-field">Or paste a NIF asset ID<input type="text" data-scene-asset-id placeholder="Saved NIF asset ID"></label>' +
    '<label class="ptp-poster-field">Object label<input type="text" data-scene-label placeholder="Product, vehicle, room…"></label>' +
    '<div class="ptp-upload-card"><div><strong>Add a splat from your device</strong><small>Choose a Gaussian PLY file (.ply). FUMOCA uploads it to your asset storage; no public URL needed.</small></div><button type="button" data-scene-pick-ply>＋ Choose PLY file</button><input type="file" accept=".ply,application/octet-stream" data-scene-ply-file hidden></div>' +
    '<div class="ptp-poster-actions"><button type="button" data-scene-add="nif">Add saved NIF object</button><button type="button" data-scene-add="ply">Add Gaussian PLY URL</button></div>' +
    '<div data-scene-list class="ptp-poster-status">Main subject is ready.</div>' +
    '<label class="ptp-poster-field">Selected object motion<select data-scene-motion><option value="inherit">Use poster default</option><option value="still">Still</option><option value="gentle">Gentle</option><option value="normal">Normal</option><option value="dynamic">Dynamic</option></select></label>' +
    '<div data-scene-status class="ptp-poster-hint">Select an object to edit it with the Subject X/Y, scale and rotation controls.</div>';
  const controls = root.querySelector('[data-poster-field="x"]')?.closest('.ptp-poster-grid');
  if (controls) controls.before(section);
  else root.appendChild(section);

  const render = () => {
    const state = api.getState();
    const list = section.querySelector('[data-scene-list]');
    list.replaceChildren();
    (state.composition.subjects || []).forEach(subject => {
      const row = document.createElement('div');
      row.className = 'ptp-scene-row';
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.sceneAction = 'select'; button.dataset.id = subject.id;
      button.textContent = subject.label + (subject.source.type === 'current' ? ' · Current' : ' · ' + subject.source.type.toUpperCase());
      button.className = 'ptp-scene-select';
      if (subject.id === state.selectedSubjectId) button.classList.add('is-selected');
      const visibility = document.createElement('button');
      visibility.type = 'button'; visibility.dataset.sceneAction = 'visibility'; visibility.dataset.id = subject.id;
      visibility.textContent = subject.visible ? 'Hide' : 'Show';
      const lock = document.createElement('button');
      lock.type = 'button'; lock.dataset.sceneAction = 'lock'; lock.dataset.id = subject.id;
      lock.textContent = subject.locked ? 'Unlock' : 'Lock';
      const back = document.createElement('button');
      back.type = 'button'; back.dataset.sceneAction = 'back'; back.dataset.id = subject.id;
      back.textContent = '↓'; back.title = 'Send backward'; back.className = 'ptp-scene-action';
      back.disabled = subject.z <= 1 || subject.locked;
      const front = document.createElement('button');
      front.type = 'button'; front.dataset.sceneAction = 'front'; front.dataset.id = subject.id;
      front.textContent = '↑'; front.title = 'Bring forward'; front.className = 'ptp-scene-action';
      front.disabled = subject.z >= 99 || subject.locked;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.dataset.sceneAction = 'remove'; remove.dataset.id = subject.id;
      remove.textContent = '×'; remove.disabled = subject.id === 'subject_main';
      visibility.className = 'ptp-scene-action';
      lock.className = 'ptp-scene-action';
      remove.className = 'ptp-scene-action ptp-scene-remove';
      const layer = document.createElement('span');
      layer.className = 'ptp-scene-layer'; layer.textContent = 'L' + subject.z;
      layer.title = 'Layer depth';
      row.append(button, layer, back, front, visibility, lock, remove); list.appendChild(row);
    });
    const selected = (state.composition.subjects || []).find(item => item.id === state.selectedSubjectId);
    section.querySelector('[data-scene-status]').textContent = selected
      ? selected.label + ' selected · ' + (selected.locked ? 'locked' : 'unlocked') + ' · ' +
        (selected.source.type === 'current' ? 'current viewer source' : 'loads independently in the published Spark viewer')
      : 'Select an object.';
    const motionSelect = section.querySelector('[data-scene-motion]');
    if (motionSelect && selected && document.activeElement !== motionSelect) motionSelect.value = selected.motion?.level || 'inherit';
    const transform = selected || state.composition.object;
    for (const key of ['x','y','scale','rotation']) {
      const input = root.querySelector('[data-poster-field="' + key + '"]');
      const output = root.querySelector('[data-poster-value="' + key + '"]');
      if (!input || !transform) continue;
      const value = Number(transform[key] || 0);
      // Do not reset a slider during its active drag; posterChange fires on every tick.
      if (document.activeElement !== input) input.value = String(['x','y','scale'].includes(key) ? Math.round(value * 100) : Math.round(value));
      if (output) output.textContent = key === 'scale' ? value.toFixed(2) + '×' : key === 'rotation' ? Math.round(value) + '°' : Math.round(value * 100) + '%';
    }
  };

  section.querySelector('[data-scene-motion]').addEventListener('change', event => {
    const selected = api.getState().composition.subjects.find(item => item.id === api.getState().selectedSubjectId);
    if (!selected) return;
    api.updateSubject(selected.id, { motion: event.target.value === 'inherit' ? null : { level: event.target.value } });
    window.FumocaPresent?.save?.();
  });
  const pickPlyButton = section.querySelector('[data-scene-pick-ply]');
  const plyInput = section.querySelector('[data-scene-ply-file]');
  pickPlyButton.addEventListener('click', () => plyInput.click());
  plyInput.addEventListener('change', async () => {
    const file = plyInput.files?.[0];
    if (!file) return;
    const status = section.querySelector('[data-scene-status]');
    const labelInput = section.querySelector('[data-scene-label]');
    const originalLabel = pickPlyButton.textContent;
    const setStatus = message => { status.textContent = message; };
    let uploadedKey = null;
    pickPlyButton.disabled = true;
    try {
      if (!/\.ply$/i.test(file.name)) throw new Error('Choose a Gaussian PLY (.ply) file. Other formats are not yet supported by this local multi-object uploader.');
      if (file.size < 16) throw new Error('This PLY file is empty or too small.');
      // Confirm the file really is a PLY rather than trusting its extension.
      const header = new TextDecoder().decode(await file.slice(0, 32).arrayBuffer());
      if (!/^ply(?:\\r?\\n)/i.test(header)) throw new Error('This file does not have a valid PLY header.');
      const client = window._fumocaSupabase || window.supabase;
      if (!client?.auth?.getUser) throw new Error('Account connection is not ready. Sign in and try again.');
      const { data: auth, error: authError } = await client.auth.getUser();
      if (authError || !auth?.user) throw new Error('Sign in before uploading an additional splat.');
      const userId = auth.user.id;
      const recordId = window._fumocaCurrentRecord?.id || 'draft';
      const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_').slice(-100) || 'subject.ply';
      const key = 'poster-subjects/' + userId + '/' + recordId + '/' + Date.now() + '-' + safeName;
      setStatus('Uploading ' + file.name + ' · 0%');
      const result = await r2.from('nif-files').upload(key, file, {
        contentType: 'application/octet-stream',
        onProgress: pct => setStatus('Uploading ' + file.name + ' · ' + pct + '%'),
      });
      if (result.error || !result.publicUrl || !result.fileKey) throw result.error || new Error('Storage did not return a usable file URL.');
      uploadedKey = result.fileKey;
      try {
        api.addSubject({
          label: labelInput.value.trim() || file.name.replace(/\\.ply$/i, ''),
          source: { type: 'ply', url: result.publicUrl },
        });
      } catch (error) {
        await r2.from('nif-files').remove([uploadedKey]);
        uploadedKey = null;
        throw error;
      }
      labelInput.value = '';
      window.FumocaPresent?.save?.();
      render();
      setStatus(file.name + ' uploaded and added. Save the poster to this NIF asset to publish the composition.');
    } catch (error) {
      console.error('[Poster Scene Manager] Local PLY upload failed:', error);
      setStatus(error?.message || 'Could not upload this PLY file.');
    } finally {
      pickPlyButton.disabled = false;
      pickPlyButton.textContent = originalLabel;
      plyInput.value = '';
    }
  });

  section.addEventListener('click', async event => {
    const loadAssets = event.target.closest('[data-scene-load-assets]');
    if (loadAssets) {
      const select = section.querySelector('[data-scene-asset-select]');
      const client = window._fumocaSupabase || window.supabase;
      loadAssets.disabled = true; loadAssets.textContent = 'Loading…';
      try {
        if (!client?.auth?.getUser || !client?.from) throw new Error('Account connection is not ready.');
        const { data: auth, error: authError } = await client.auth.getUser();
        if (authError || !auth?.user) throw new Error('Sign in to load your saved NIF assets.');
        const { data, error } = await client.from('nif_files').select('id,title')
          .eq('user_id', auth.user.id).limit(50);
        if (error) throw error;
        select.replaceChildren(new Option('Choose a saved NIF…', ''));
        (data || []).forEach(asset => select.add(new Option(asset.title || 'Untitled NIF', asset.id)));
        if (!data?.length) select.add(new Option('No saved NIF assets found', ''));
        section.querySelector('[data-scene-status]').textContent = (data?.length || 0) + ' saved NIF assets loaded. Choose one to add it.';
      } catch (error) {
        section.querySelector('[data-scene-status]').textContent = error.message || 'Could not load saved NIF assets.';
      } finally { loadAssets.disabled = false; loadAssets.textContent = 'Load my saved NIFs'; }
      return;
    }
    const action = event.target.closest('[data-scene-action]');
    if (action) {
      const id = action.dataset.id;
      const subject = api.getState().composition.subjects.find(item => item.id === id);
      if (!subject) return;
      if (action.dataset.sceneAction === 'select') api.selectSubject(id);
      if (action.dataset.sceneAction === 'visibility') api.updateSubject(id, { visible: !subject.visible });
      if (action.dataset.sceneAction === 'lock') api.updateSubject(id, { locked: !subject.locked });
      if (action.dataset.sceneAction === 'back') api.updateSubject(id, { z: Math.max(1, subject.z - 1) });
      if (action.dataset.sceneAction === 'front') api.updateSubject(id, { z: Math.min(99, subject.z + 1) });
      if (action.dataset.sceneAction === 'remove') api.removeSubject(id);
      render(); window.FumocaPresent?.save?.(); return;
    }
    const add = event.target.closest('[data-scene-add]');
    if (!add) return;
    const label = section.querySelector('[data-scene-label]').value.trim();
    let source;
    if (add.dataset.sceneAdd === 'nif') {
      source = { type:'nif', assetId:section.querySelector('[data-scene-asset-select]').value || section.querySelector('[data-scene-asset-id]').value.trim() };
    } else {
      const url = prompt('Enter a public HTTPS URL for a Gaussian PLY file:');
      if (!url) return;
      source = { type:'ply', url };
    }
    try {
      api.addSubject({ label:label || (source.type === 'nif' ? 'NIF object' : 'PLY object'), source });
      section.querySelector('[data-scene-asset-id]').value = '';
      section.querySelector('[data-scene-asset-select]').value = '';
      section.querySelector('[data-scene-label]').value = '';
      render(); window.FumocaPresent?.save?.();
    } catch (error) { alert(error.message || 'Could not add object.'); }
  });
  window.addEventListener('fumoca:posterChange', render);
  window.addEventListener('fumoca:posterSubjectError', event => {
    const status = section.querySelector('[data-scene-status]');
    if (status && event.detail?.id) {
      status.textContent = 'Could not load ' + event.detail.id + ': ' + (event.detail.message || 'unknown error');
    }
  });
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPosterSceneManager, { once:true });
else mountPosterSceneManager();
