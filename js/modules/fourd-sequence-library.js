import FourDSequence from './fourd-sequence.js';
/**
 * Assemble completed independent NIF motion moments into the v1 sequence manifest.
 * This intentionally uses hold playback: independently trained reconstructions
 * do not share proven Gaussian identity or ordering.
 */
export function buildMotionSequenceManifest(records, sequenceId, publicUrl = (key) => key) {
  if (!Array.isArray(records)) throw new TypeError('NIF records must be an array');
  if (!sequenceId || typeof sequenceId !== 'string') throw new TypeError('motion sequence id is required');
  const eligible = records.filter(row =>
    row?.r2_key &&
    Number.isInteger(Number(row.gaussian_count)) && Number(row.gaussian_count) > 0 &&
    row.meta?.motion_sequence_id === sequenceId
  );
  const ordered = eligible.map(row => ({
    row,
    index: Number(row.meta.motion_state_index),
    time: Number(row.meta.motion_state_time)
  })).sort((a, b) => a.index - b.index);

  if (ordered.length < 2) throw new Error('A motion sequence needs at least two completed NIF moments');
  const seenIndices = new Set();
  const frames = ordered.map(({ row, index, time }) => {
    if (!Number.isInteger(index) || index < 0 || seenIndices.has(index)) {
      throw new Error('Motion sequence contains a missing or duplicate state index');
    }
    seenIndices.add(index);
    if (!Number.isFinite(time) || time < 0) throw new Error(`Motion state ${index} has no valid timestamp`);
    const url = publicUrl(row.r2_key);
    if (typeof url !== 'string' || !url.trim()) throw new Error(`NIF ${row.id} has no resolvable asset URL`);
    return {
      time,
      url,
      format: 'nif',
      gaussianCount: Number(row.gaussian_count),
      // Independent jobs have independent Gaussian identities. Unique IDs
      // force hold playback and prevent unsafe interpolation.
      topologyId: `independent-nif:${row.id}`,
      stateId: row.id,
      label: row.meta.motion_state_label || row.title || `Moment ${index + 1}`
    };
  });
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].time <= frames[i - 1].time) {
      throw new Error('Motion moment timestamps must be strictly increasing');
    }
  }
  const frameRate = 30;
  const duration = Math.max(frames[frames.length - 1].time + 1 / frameRate, 1 / frameRate);
  return {
    schema: 'fumoca.4d.sequence',
    version: 1,
    id: sequenceId,
    duration,
    frameRate,
    interpolation: 'hold',
    frames
  };
}

export async function loadMotionSequence(supabase, sequenceId) {
  if (!supabase) throw new TypeError('Supabase client is required');
  const { data, error } = await supabase
    .from('nif_files')
    .select('id,title,r2_key,gaussian_count,meta,created_at')
    .contains('meta', { motion_sequence_id: sequenceId });
  if (error) throw error;
  const { default: r2 } = await import('../r2Client.js');
  return buildMotionSequenceManifest(data || [], sequenceId, key => r2.publicUrl('nif-files', key));
}

let _loadGeneration = 0;
let _activePlayer = null;
let _activeControls = null;

function _formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function _ensurePlaybackControls() {
  if (_activeControls || typeof document === 'undefined') return _activeControls;
  const root = document.createElement('div');
  root.id = 'fumoca4dSequenceControls';
  root.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9000;display:flex;align-items:center;gap:10px;width:min(620px,calc(100vw - 28px));padding:10px 14px;border:1px solid rgba(200,255,0,.25);border-radius:14px;background:rgba(5,8,13,.9);backdrop-filter:blur(18px);box-shadow:0 12px 40px rgba(0,0,0,.35);color:#fff;font:12px/1.2 system-ui,sans-serif';
  root.innerHTML = `
    <button type="button" data-action="play" style="border:1px solid rgba(200,255,0,.35);background:rgba(200,255,0,.12);color:#d9ff62;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer">Play</button>
    <span data-role="time" style="font-variant-numeric:tabular-nums;color:rgba(255,255,255,.65);white-space:nowrap">0:00</span>
    <input data-role="seek" type="range" min="0" max="1" step="0.01" value="0" aria-label="Motion sequence position" style="flex:1;min-width:50px;accent-color:#c8ff00">
    <select data-role="speed" aria-label="Playback speed" style="background:#111820;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:7px;padding:6px">
      <option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option>
    </select>
    <span data-role="count" style="color:rgba(255,255,255,.45);white-space:nowrap">0 / 0</span>`;
  document.body.appendChild(root);
  _activeControls = {
    root,
    button: root.querySelector('[data-action="play"]'),
    seek: root.querySelector('[data-role="seek"]'),
    speed: root.querySelector('[data-role="speed"]'),
    time: root.querySelector('[data-role="time"]'),
    count: root.querySelector('[data-role="count"]')
  };
  _activeControls.button.addEventListener('click', () => {
    if (!_activePlayer) return;
    if (_activePlayer.playing) {
      _activePlayer.pause();
      _activeControls.button.textContent = 'Play';
    } else {
      _activePlayer.play();
      _activeControls.button.textContent = 'Pause';
    }
  });
  _activeControls.seek.addEventListener('input', () => {
    if (_activePlayer) _activePlayer.seek(Number(_activeControls.seek.value));
  });
  _activeControls.speed.addEventListener('change', () => {
    _activePlayer?.setSpeed(Number(_activeControls.speed.value));
  });
  return _activeControls;
}

async function _startViewerPlayback(manifest) {
  if (!window._fumocaLoadMotionSequenceNif || !window.Fumoca4DSequence) {
    throw new Error('Viewer NIF frame loader is not ready');
  }
  if (_activePlayer) await _activePlayer.dispose();
  const controls = _ensurePlaybackControls();
  if (!controls) return null;
  let activeRecordId = null;
  let loadingRecordId = null;
  let loadingRecordPromise = null;
  const adapter = {
    async loadFrame(frame) {
      return { recordId: frame.stateId, url: frame.url };
    },
    async presentFrame(handle, context) {
      if (handle.recordId && handle.recordId !== activeRecordId) {
        if (loadingRecordId !== handle.recordId) {
          loadingRecordId = handle.recordId;
          loadingRecordPromise = window._fumocaLoadMotionSequenceNif(handle.recordId)
            .then(() => { activeRecordId = handle.recordId; })
            .finally(() => { loadingRecordId = null; loadingRecordPromise = null; });
        }
        await loadingRecordPromise;
      }
      controls.seek.max = String(manifest.duration);
      controls.seek.value = String(context.time);
      controls.time.textContent = _formatTime(context.time);
      controls.count.textContent = `${context.frameIndex + 1} / ${manifest.frames.length}`;
    },
    disposeFrame() {}
  };
  _activePlayer = FourDSequence.create(manifest, adapter, { loop: true });
  window._fumocaMotionSequencePlayer = _activePlayer;
  controls.root.style.display = 'flex';
  controls.button.textContent = 'Pause';
  await _activePlayer.seek(0);
  _activePlayer.play();
  return _activePlayer;
}

async function _onRecordLoaded(event) {
  const record = event?.detail?.record || window._fumocaCurrentRecord || null;
  const sequenceId = record?.meta?.motion_sequence_id;
  if (!sequenceId || !window._fumocaSupabase) return;
  const generation = ++_loadGeneration;
  try {
    const manifest = await loadMotionSequence(window._fumocaSupabase, sequenceId);
    if (generation !== _loadGeneration) return;
    window._fumocaMotionSequenceManifest = manifest;
    await _startViewerPlayback(manifest);
    window.dispatchEvent(new CustomEvent('fumoca:motionSequenceReady', {
      detail: { sequenceId, manifest, frameCount: manifest.frames.length }
    }));
  } catch (error) {
    if (generation !== _loadGeneration) return;
    console.warn('[FUMOCA 4D] Motion sequence is not ready yet:', error);
    window.dispatchEvent(new CustomEvent('fumoca:motionSequenceUnavailable', {
      detail: { sequenceId, message: error?.message || String(error) }
    }));
  }
}

const Fumoca4DSequenceLibrary = {
  buildMotionSequenceManifest,
  loadMotionSequence,
  refresh: _onRecordLoaded
};
if (typeof window !== 'undefined') {
  window.Fumoca4DSequenceLibrary = Fumoca4DSequenceLibrary;
  window.addEventListener('fumoca:recordLoaded', _onRecordLoaded);
  if (window._fumocaCurrentRecord) _onRecordLoaded({ detail: { record: window._fumocaCurrentRecord } });
}
export default Fumoca4DSequenceLibrary;
