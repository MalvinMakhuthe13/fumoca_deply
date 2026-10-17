import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/modules/pipeline.js', import.meta.url), 'utf8');
assert.match(source, /\.from\('nif-videos'\)\s*\.upload\(/, 'source videos must use the deployed R2 bucket');
assert.match(source, /\.from\('reconstruction_jobs'\)\s*\.insert\(/, 'uploads must enqueue the deployed job record');
assert.match(source, /raw_r2_key:\s*fileKey/, 'worker input must use the actual uploaded R2 key');
assert.match(source, /capture_mode:\s*metadata\.capture_mode\s*\|\|\s*'video'/, 'job must specify capture mode');
assert.match(source, /file_size:\s*file\.size/, 'source size should be persisted');
assert.match(source, /meta:\s*\{[\s\S]*original_filename:\s*file\.name/, 'original filename belongs in JSON metadata');
assert.match(source, /if \(jobError \|\| !job\)[\s\S]*r2\.from\('nif-videos'\)\.remove\(\[fileKey\]\)/, 'failed job registration should clean up the source object');
assert.doesNotMatch(source, /from\(['"]splats['"]\)|from\(['"]processing_jobs['"]\)|from\(['"]splat-videos['"]\)/, 'must not reference absent legacy tables/bucket');
console.log('Upload pipeline schema and orphan cleanup contract passed.');
