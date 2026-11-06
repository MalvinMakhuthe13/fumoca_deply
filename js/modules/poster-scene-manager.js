/**
 * FUMOCA Poster Scene Manager
 * UI for managing independently transformable composition subjects.
 */
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
    '<div class="ptp-poster-actions"><button type="button" data-scene-add="nif">Add NIF object</button><button type="button" data-scene-add="ply">Add Gaussian PLY URL</button></div>' +
    '<div data-scene-list class="ptp-poster-status">Main subject is ready.</div>' +
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
      const remove = document.createElement('button');
      remove.type = 'button'; remove.dataset.sceneAction = 'remove'; remove.dataset.id = subject.id;
      remove.textContent = '×'; remove.disabled = subject.id === 'subject_main';
      visibility.className = 'ptp-scene-action';
      lock.className = 'ptp-scene-action';
      remove.className = 'ptp-scene-action ptp-scene-remove';
      row.append(button, visibility, lock, remove); list.appendChild(row);
    });
    const selected = (state.composition.subjects || []).find(item => item.id === state.selectedSubjectId);
    section.querySelector('[data-scene-status]').textContent = selected
      ? selected.label + ' selected · ' + (selected.locked ? 'locked' : 'unlocked') + ' · ' +
        (selected.source.type === 'current' ? 'current viewer source' : 'loads independently in the published Spark viewer')
      : 'Select an object.';
    const transform = selected || state.composition.object;
    for (const key of ['x','y','scale','rotation']) {
      const input = root.querySelector('[data-poster-field="' + key + '"]');
      const output = root.querySelector('[data-poster-value="' + key + '"]');
      if (!input || !transform) continue;
      const value = Number(transform[key] || 0);
      input.value = String(['x','y','scale'].includes(key) ? Math.round(value * 100) : Math.round(value));
      if (output) output.textContent = key === 'scale' ? value.toFixed(2) + '×' : key === 'rotation' ? Math.round(value) + '°' : Math.round(value * 100) + '%';
    }
  };

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
