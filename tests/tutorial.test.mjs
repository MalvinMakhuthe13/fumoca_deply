import assert from 'node:assert/strict';
import { fitScreenQuad, normalizeTutorial, normalizeStep } from '../js/modules/tutorial.js';

// a 0.07 × 0.15 phone screen, tilted 30° and offset, with a little noise
const rot = (p, a) => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)];
const P = [], idx = [];
for (let i = 0; i < 2000; i++) {
  const p = rot([(Math.random() - 0.5) * 0.07, (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.0005], Math.PI / 6);
  P.push(p[0] + 1, p[1] + 2, p[2] + 3); idx.push(i);
}
const fit = fitScreenQuad(Float32Array.from(P), idx);
const len = (v) => Math.hypot(...v);
assert.ok(Math.abs(len(fit.u) * 2 - 0.15) < 0.01, 'long side ≈ 15 cm: ' + len(fit.u) * 2);
assert.ok(Math.abs(len(fit.v) * 2 - 0.07) < 0.006, 'short side ≈ 7 cm: ' + len(fit.v) * 2);
assert.ok(Math.abs(fit.center[0] - 1) < 0.005 && Math.abs(fit.center[1] - 2) < 0.005 && Math.abs(fit.center[2] - 3) < 0.005, 'centre');
const n = rot([0, 0, 1], Math.PI / 6);
assert.ok(Math.abs(Math.abs(fit.normal[0] * n[0] + fit.normal[1] * n[1] + fit.normal[2] * n[2]) - 1) < 0.01, 'normal matches the tilt');
assert.throws(() => fitScreenQuad(Float32Array.from(P), [1, 2, 3]), /Select the screen/);

// untrusted data
const t = normalizeTutorial({ title: 'x'.repeat(200), steps: [{ title: 'Power on', view: { position: [0, 0, 1], target: [0, 0, 0] }, media: 'javascript:alert(1)', narration: 'data:audio/x', action: { type: 'eval' }, seconds: 999, highlight: [0, 0, 'a'] }],
  screens: [{ center: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], name: '<b>' }, { center: [0, 0] }] });
assert.equal(t.title.length, 80);
assert.equal(t.steps[0].media, ''); assert.equal(t.steps[0].narration, ''); assert.equal(t.steps[0].action, null);
assert.equal(t.steps[0].seconds, 120); assert.equal(t.steps[0].highlight, null);
assert.equal(t.screens.length, 1);
assert.equal(normalizeTutorial({}), null);
assert.equal(normalizeStep({ action: { type: 'part', partId: 'door', to: 'open' } }).action.partId, 'door');
console.log('tutorial: all tests passed');
