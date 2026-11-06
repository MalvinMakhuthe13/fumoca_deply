/**
 * FUMOCA Poster Scene Manager
 * UI for staging and managing independently transformable composition subjects.
 * Additional source loading/rendering is intentionally delegated to the scene renderer.
 */
function mountPosterSceneManager() {
  const root = document.getElementById('ptpPosterComposer');
  const api = window.FumocaPoster;
  if (!root || !api || root.querySelector('[data-fumoca-scene-manager]')) return;
  const section = document.createElement('section');
  section.dataset.fumocaSceneManager = '1';
  section.innerHTML = '<div class="ptp-poster-subtitle">3D SCENE OBJECTS</div>' +
    '<p class="ptp-poster-hint">Manage the objects in this composition. The current viewer is the primary subject. Additional assets are staged here for the multi-splat renderer integration.</p>' +
    '<label class="ptp-poster-field">Saved NIF asset ID<input type="text" data-scene-asset-id placeholder="Paste a saved NIF asset ID"></label>' +
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
      row.style.cssText = 'display:flex;gap:5px;align-items:center;margin:5px 0';
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.sceneAction = 'select'; button.dataset.id = subject.id;
      button.textContent = subject.label + (subject.source.type === 'current' ? ' · Current' : ' · ' + subject.source.type.toUpperCase());
      button.style.cssText = 'flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis';
      if (subject.id === state.selectedSubjectId) button.style.borderColor = '#c8ff00';
      const visibility = document.createElement('button');
      visibility.type = 'button'; visibility.dataset.sceneAction = 'visibility'; visibility.dataset.id = subject.id;
      visibility.textContent = subject.visible ? 'Hide' : 'Show';
      const lock = document.createElement('button');
      lock.type = 'button'; lock.dataset.sceneAction = 'lock'; lock.dataset.id = subject.id;
      lock.textContent = subject.locked ? 'Unlock' : 'Lock';
      const remove = document.createElement('button');
      remove.type = 'button'; remove.dataset.sceneAction = 'remove'; remove.dataset.id = subject.id;
      remove.textContent = '×'; remove.disabled = subject.id === 'subject_main';
      [button, visibility, lock, remove].forEach(node => {
        Object.assign(node.style, { padding:'5px 7px', border:'1px solid rgba(255,255,255,.16)', borderRadius:'6px', background:'#20242b', color:'#fff', fontSize:'10px' });
      });
      row.append(button, visibility, lock, remove); list.appendChild(row);
    });
    const selected = (state.composition.subjects || []).find(item => item.id === state.selectedSubjectId);
    section.querySelector('[data-scene-status]').textContent = selected
      ? selected.label + ' selected · ' + (selected.locked ? 'locked' : 'unlocked') + ' · ' +
        (selected.source.type === 'current' ? 'current viewer source' : 'source staged; renderer integration pending')
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
  section.addEventListener('click', event => {
    const action = event.target.closest('[data-scene-action]');
    if (action) {
      const id = action.dataset.id;
      const subject = api.getState().composition.subjects.find(item => item.id === id);
      if (!subject) return;
      if (action.dataset.sceneAction === 'select') api.selectSubject(id);
      if (action.dataset.sceneAction === 'visibility') api.updateSubject(id, { visible: !subject.visible });
      if (action.dataset.sceneAction === 'lock') api.updateSubject(id, { locked: !subject.locked });
      if (action.dataset.sceneAction === 'remove') api.removeSubject(id);
      render(); window.dispatchEvent(new Event('fumoca:presentPersist')); return;
    }
    const add = event.target.closest('[data-scene-add]');
    if (!add) return;
    const label = section.querySelector('[data-scene-label]').value.trim();
    let source;
    if (add.dataset.sceneAdd === 'nif') {
      source = { type:'nif', assetId:section.querySelector('[data-scene-asset-id]').value.trim() };
    } else {
      const url = prompt('Enter a public HTTPS URL for a Gaussian PLY file:');
      if (!url) return;
      source = { type:'ply', url };
    }
    try {
      api.addSubject({ label:label || (source.type === 'nif' ? 'NIF object' : 'PLY object'), source });
      section.querySelector('[data-scene-asset-id]').value = '';
      section.querySelector('[data-scene-label]').value = '';
      render(); window.dispatchEvent(new Event('fumoca:presentPersist'));
    } catch (error) { alert(error.message || 'Could not add object.'); }
  });
  window.addEventListener('fumoca:posterChange', render);
  window.addEventListener('fumoca:presentPersist', () => {
    const save = document.querySelector('#ptpPosterComposer [data-act="poster-cloud-save"]');
    if (save) save.dispatchEvent(new Event('click', { bubbles:true }));
  });
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPosterSceneManager, { once:true });
else mountPosterSceneManager();
