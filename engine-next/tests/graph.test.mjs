import { NIFGraph, NODE_TYPE } from '../graph/NIFGraph.js';

let pass=0, fail=0;
function check(name, cond, detail='') { if(cond){pass++;console.log('PASS:',name);} else {fail++;console.log('FAIL:',name,detail);} }

// Build a realistic scene: a car body + a wheel, matching the automotive
// inspection use case (vehicle scan -> spin wheel -> click for damage report)
const g = new NIFGraph({ title: 'Test Vehicle Scan', vertical: 'automotive' });

const body  = g.addMesh('body',  'https://cdn.fumoca.co.za/assets/body.glb');
const wheel = g.addMesh('wheel', 'https://cdn.fumoca.co.za/assets/wheel.glb', {
  transform_note: 'front-left', meta: { position:[1.2,0,1.8] }
});
g.parent('wheel', 'body');

check('addMesh returns a SpatialNode with correct type', wheel.type === NODE_TYPE.MESH);
check('parent() creates a CHILD edge on the parent', body.getEdges().some(e => e.targetId === 'wheel'));
check('parent() records parentId on the child meta', wheel.meta.parentId === 'body');

// --- Animate the wheel spinning (quaternion rotation over time) via the FULL graph API ---
g.animate('wheel', 'rotation', [
  { t: 0,   v: [1,0,0,0] },          // identity quaternion
  { t: 1,   v: [0.7071,0,0.7071,0] }, // 90° around Y
], { easing: 'linear' });

// tick forward in small steps to t=0.5 (should be halfway through the slerp)
g.tick(0.5);
const stateAt05 = g.spatial.get('wheel').meta.rotation;
check('animation applied to node.meta.rotation via tick()', Array.isArray(stateAt05), JSON.stringify(stateAt05));
// halfway slerp between identity and 90°-around-Y should be ~45° around Y: w≈cos(22.5°)≈0.9239, y≈sin(22.5°)≈0.3827
const halfwayCorrect = Math.abs(stateAt05[0]-0.9239) < 0.01 && Math.abs(stateAt05[2]-0.3827) < 0.01;
check('quaternion slerp interpolation is mathematically correct at t=0.5', halfwayCorrect, JSON.stringify(stateAt05));

g.tick(0.5); // now at t=1.0, should equal end keyframe
const stateAt10 = g.spatial.get('wheel').meta.rotation;
check('animation reaches exact end keyframe at t=1.0', Math.abs(stateAt10[0]-0.7071)<0.001 && Math.abs(stateAt10[2]-0.7071)<0.001, JSON.stringify(stateAt10));

// --- seekTo (should be deterministic - same result as tick()ing to that time) ---
const seekResult = g.seekTo(0.5);
check('seekTo() is deterministic and matches the earlier tick() result at the same time', 
  Math.abs(seekResult.get('wheel').rotation[0]-0.9239) < 0.01);

// --- Interaction: click wheel -> run a script action ---
let scriptFired = null;
g.interaction.addScript('damageReport', (ctx) => { scriptFired = ctx.nodeId; return { damage: 'minor scratch', confidence: 0.94 }; });
g.action('showDamage', 'run_script', { scriptId: 'damageReport' });
g.onClick('wheel', 'showDamage');
const clickResults = g.interaction.fireEvent('wheel', 'click', { nodeId: 'wheel' });
check('onClick -> action -> script actually executes', scriptFired === 'wheel');
check('fireEvent returns the script result', clickResults[0]?.damage === 'minor scratch', JSON.stringify(clickResults));

// clicking a node with no bound action should return empty, not throw
const noopResult = g.interaction.fireEvent('body', 'click', {});
check('clicking a node with no bound action returns empty array (no crash)', Array.isArray(noopResult) && noopResult.length === 0);

// --- Semantic validation with a real custom inspection plugin schema ---
g.semantic.registerPlugin('inspection', {
  tags: ['load-bearing', 'wear-item'],
  validate: (node, tags) => {
    const errors = [];
    if (tags.includes('wear-item') && !node.meta.lastInspected) {
      errors.push('wear-item missing lastInspected date');
    }
    return { errors, warnings: [] };
  }
});
g.tag('wheel', 'wear-item');
const report1 = g.validate();
check('validate() catches a real missing-field error via a custom plugin', report1.errors.length === 1, JSON.stringify(report1));
check('validate() error message includes plugin id and node id', report1.errors[0].includes('inspection') && report1.errors[0].includes('wheel'));

// fix the issue and re-validate
g.spatial.get('wheel').meta.lastInspected = '2026-07-01';
const report2 = g.validate();
check('validate() passes once the flagged issue is fixed', report2.errors.length === 0, JSON.stringify(report2));

// --- LOD selection (device-tier aware) ---
const nearHighEnd = wheel.selectRepresentation(5, 2);
const midLowEnd    = wheel.selectRepresentation(30, 0);   // tier-0 exclusion window is >10, not >5
const veryFar      = wheel.selectRepresentation(1500, 2); // proxy threshold is 1000, not 500
check('close + high-end device gets full depth_field', nearHighEnd === 'depth_field', nearHighEnd);
check('mid-range + LOW-end device (tier 0) skips depth_field per the tier rule', midLowEnd !== 'depth_field', midLowEnd);
check('very far (beyond 1000) camera gets proxy representation', veryFar === 'proxy', veryFar);

// --- Serialization round-trip ---
const json = g.toJSON();
const g2 = NIFGraph.fromJSON(json);
check('fromJSON reconstructs the right number of spatial nodes', g2.spatial.size === g.spatial.size, `${g2.spatial.size} vs ${g.spatial.size}`);
check('fromJSON preserves node type', g2.spatial.get('wheel').type === NODE_TYPE.MESH);
check('fromJSON preserves vertical/title', g2.vertical === 'automotive' && g2.title === 'Test Vehicle Scan');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
