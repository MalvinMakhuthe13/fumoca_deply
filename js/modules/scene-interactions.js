/**
 * FUMOCA Scene Interactions
 * Unified “real interactivity”: hotspots + state (doors, lights, etc.)
 *
 * Listens for fumoca:action / runs hotspot-actions, and maintains a
 * simple state map that the viewer can animate:
 *   door_fl: closed|open
 *   door_fr: closed|open
 *   lights: off|on
 *   material: string
 *
 * Does not require a separate car engine — any scene can declare states.
 */
import { runAction, stopAllAudio } from './hotspot-actions.js';

const state = new Map();
const listeners = new Set();

export function getInteractionState(key) {
  return key ? state.get(key) : Object.fromEntries(state);
}

export function setInteractionState(key, value, { silent = false } = {}) {
  const prev = state.get(key);
  state.set(key, value);
  if (!silent && prev !== value) {
    const detail = { key, value, prev, state: Object.fromEntries(state) };
    document.dispatchEvent(new CustomEvent('fumoca:state', { detail }));
    listeners.forEach((fn) => {
      try {
        fn(detail);
      } catch (e) {
        console.warn('[interactions]', e);
      }
    });
  }
}

export function onStateChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Built-in action: type state */
export function applyStateAction(action) {
  if (!action || action.type !== 'state') return;
  const key = action.key || action.name;
  if (!key) return;
  let value = action.value;
  if (action.toggle) {
    const cur = state.get(key);
    value =
      action.toggleValues?.length === 2
        ? cur === action.toggleValues[0]
          ? action.toggleValues[1]
          : action.toggleValues[0]
        : cur === 'open' || cur === 'on'
          ? cur === 'open'
            ? 'closed'
            : 'off'
          : cur === 'closed'
            ? 'open'
            : 'on';
  }
  setInteractionState(key, value);
}

/**
 * Run any hotspot action, with state + audio awareness.
 */
export async function triggerAction(action, ctx = {}) {
  if (!action) return;
  if (action.type === 'state') {
    applyStateAction(action);
    if (action.sound) {
      const { playOneShot } = await import('./scene-audio.js');
      playOneShot(action.sound, { volume: action.volume ?? 0.8 });
    }
    return;
  }
  if (action.type === 'multi' && Array.isArray(action.steps)) {
    for (const step of action.steps) {
      await triggerAction(step, ctx);
    }
    return;
  }
  return runAction(action, ctx);
}

/** Presets for common product demos */
export const PRESETS = {
  carDoorFL: {
    label: 'Open front-left door',
    icon: '🚪',
    action: {
      type: 'multi',
      steps: [
        { type: 'state', key: 'door_fl', value: 'open' },
        { type: 'audio', url: '', /* set per asset */ loop: false },
      ],
    },
  },
  lightsOn: {
    label: 'Lights on',
    icon: '💡',
    action: { type: 'state', key: 'lights', value: 'on', toggle: true, toggleValues: ['off', 'on'] },
  },
};

/**
 * Example hotspot set for a vehicle listing (fill audio URLs in Studio later).
 */
export function vehicleDemoHotspots({ doorSoundUrl, engineSoundUrl } = {}) {
  return [
    {
      id: 'hs_door_fl',
      title: 'Driver door',
      x: 30,
      y: 55,
      actions: [
        {
          id: 'a_door',
          label: 'Open / close',
          icon: '🚪',
          action: {
            type: 'multi',
            steps: [
              {
                type: 'state',
                key: 'door_fl',
                toggle: true,
                toggleValues: ['closed', 'open'],
                sound: doorSoundUrl || undefined,
              },
            ],
          },
        },
      ],
    },
    {
      id: 'hs_lights',
      title: 'Headlights',
      x: 70,
      y: 48,
      actions: [
        {
          id: 'a_lights',
          label: 'Lights',
          icon: '💡',
          action: {
            type: 'state',
            key: 'lights',
            toggle: true,
            toggleValues: ['off', 'on'],
          },
        },
      ],
    },
    {
      id: 'hs_engine',
      title: 'Engine start',
      x: 50,
      y: 40,
      actions: [
        {
          id: 'a_eng',
          label: 'Start / stop',
          icon: '🔑',
          action: {
            type: 'state',
            key: 'engine',
            toggle: true,
            toggleValues: ['off', 'on'],
            sound: engineSoundUrl || undefined,
          },
        },
      ],
    },
    {
      id: 'hs_ivi',
      title: 'Infotainment',
      x: 48,
      y: 62,
      actions: [
        {
          id: 'a_ivi',
          label: 'Screen on / off',
          icon: '📱',
          action: {
            type: 'state',
            key: 'ivi',
            toggle: true,
            toggleValues: ['off', 'on'],
          },
        },
      ],
    },
  ];
}

export function stopInteractionsAudio() {
  stopAllAudio();
}

if (typeof window !== 'undefined') {
  window.FUMOCA_SceneInteractions = {
    getInteractionState,
    setInteractionState,
    onStateChange,
    triggerAction,
    applyStateAction,
    vehicleDemoHotspots,
    PRESETS,
  };
}
