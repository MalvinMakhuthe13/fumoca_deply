/**
 * NIFAnimationSequencer — compile an ordered list of animation steps into a
 * single hotspot action, and preview it live.
 * fumoca.co.za · © Fumoca Technologies
 *
 * WHY THIS FILE EXISTS
 * ─────────────────────
 * NIFAnimator.js plays exactly one animation per trigger. Real choreography
 * — "open the door, wait, THEN open the trunk, wait less, THEN close the
 * door" — needs several `animate` actions to run in order with different
 * gaps between them. hotspot-actions.js's `'multi'` action type already
 * exists for sequencing (audio then a card, etc.), but until this same
 * session it only supported a single shared delay applied after every
 * step — there was no way to give step 1 a 1000ms gap and step 2 a 300ms
 * gap. That's fixed in hotspot-actions.js (`delayAfter` per step). This
 * file is the thing that actually builds a valid sequence for you instead
 * of hand-writing nested action JSON.
 *
 * A "sequence" here is just an ordered array of step descriptors — this
 * module's only real jobs are (1) turn that into the exact action shape
 * runAction()'s `'multi'`/`'animate'` cases expect, and (2) run it against
 * a live viewer for preview before you save it to a hotspot.
 */

/**
 * @typedef {object} SequenceStep
 * @property {string} layer         required — matches a LAYER_GEO label
 * @property {'hinge'|'slide'} [kind]  default 'hinge'
 * @property {number} [angleDeg]    hinge only
 * @property {number[]} [axis]      hinge only
 * @property {number[]} [pivot]     hinge only
 * @property {number[]} [direction] slide only
 * @property {number} [distance]    slide only
 * @property {boolean} [toggle]     default true
 * @property {number} [durationMs]  default 900
 * @property {number} [delayAfter]  ms to wait after this step before the next one starts, default 400
 */

/**
 * Compile an ordered list of steps into a single hotspot action object.
 * @param {SequenceStep[]} steps
 * @returns {object} a valid `{type:'multi', actions:[...]}` action —
 *   assign it directly to a hotspot's `actions[].action` field.
 */
export function compileSequence(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('compileSequence needs a non-empty array of steps');
  }
  return {
    type: 'multi',
    actions: steps.map((s, i) => {
      if (!s.layer) throw new Error(`Step ${i} is missing "layer"`);
      const animateAction = { type: 'animate', layer: s.layer };
      if (s.kind === 'slide') {
        animateAction.kind = 'slide';
        if (s.direction) animateAction.direction = s.direction;
        if (s.distance != null) animateAction.distance = s.distance;
      } else {
        if (s.axis)  animateAction.axis  = s.axis;
        if (s.pivot) animateAction.pivot = s.pivot;
        if (s.angleDeg != null) animateAction.angleDeg = s.angleDeg;
      }
      if (s.toggle != null)     animateAction.toggle = s.toggle;
      if (s.durationMs != null) animateAction.durationMs = s.durationMs;
      return { action: animateAction, delayAfter: s.delayAfter ?? 400 };
    }),
  };
}

/**
 * Run a sequence immediately against a live viewer — for previewing before
 * you commit it to a hotspot. Requires hotspot-actions.js's runAction.
 * @param {SequenceStep[]} steps
 * @param {(action, context) => Promise} runAction  pass the imported runAction
 *   from hotspot-actions.js (not imported directly here to avoid a circular
 *   dependency — hotspot-actions.js doesn't import this file, and shouldn't
 *   need to just to preview a sequence).
 * @param {object} context  same context shape runAction expects (viewer, hotspot)
 */
export async function previewSequence(steps, runAction, context = {}) {
  const compiled = compileSequence(steps);
  return runAction(compiled, context);
}

/**
 * Total wall-clock time a sequence will take to fully play out (sum of each
 * step's duration + its delayAfter) — useful for a UI to show "≈3.2s" next
 * to a sequence, or to know when it's safe to let the same hotspot be
 * clicked again.
 */
export function estimateSequenceDuration(steps) {
  return (steps ?? []).reduce((total, s) =>
    total + (s.durationMs ?? 900) + (s.delayAfter ?? 400), 0);
}
