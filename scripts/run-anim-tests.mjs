/**
 * Run every tests/anim-*.test.mjs file.
 * Dependencies resolve from this repo (three@0.180.0, @dimforge/rapier3d-compat@0.21.0).
 */
import { readdirSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

const files = readdirSync('tests').filter(name => (name.startsWith('anim-') || name.startsWith('fourd-') || name.startsWith('manual-gaussian-') || name.startsWith('manual-gaussian-editor-')) && name.endsWith('.test.mjs')).sort();
let failed = 0;
for (const name of files) {
  const file = join('tests', name);
  const args = name.startsWith('manual-gaussian-') ? ['--experimental-default-type=module', file] : [file];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    failed += 1;
    console.error(`SUITE FAILED: ${file}`);
  }
}
if (failed) {
  console.error(`${failed} of ${files.length} animation suites failed`);
  process.exit(1);
}
console.log(`All ${files.length} animation suites passed`);
