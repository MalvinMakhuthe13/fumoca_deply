import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../engine-next/backend-api/index.js', import.meta.url), 'utf8');
const measurementStart = source.indexOf("app.post('/api/nif/:id/measurements'");
const editStart = source.indexOf("app.post('/api/nif/:id/edits'", measurementStart);
assert.ok(measurementStart >= 0 && editStart > measurementStart, 'measurement and edit routes must exist');
const measurements = source.slice(measurementStart, editStart);
assert.match(measurements, /measurements\.length > 500/, 'measurement batches must be bounded');
assert.match(measurements, /\.eq\('id', req\.params\.id\)\.eq\('user_id', req\.user\.id\)/,
  'measurement writes must be owner-scoped');
assert.match(measurements, /update\(\{ meta: updatedMeta \}\)/, 'measurements must merge into META');
assert.match(measurements, /if \(writeError\) return res\.status\(500\)/,
  'measurement route must not report success when the database write fails');

const editsEnd = source.indexOf('\n});', editStart);
assert.ok(editsEnd > editStart, 'edit route must close');
const edits = source.slice(editStart, editsEnd);
assert.match(edits, /status\(501\)/, 'raw binary scene edits must fail closed until canonical NIF serialization exists');
assert.match(edits, /CANONICAL_NIF_SERIALIZER_REQUIRED/, 'the disabled route must explain the missing serializer');
assert.doesNotMatch(edits, /PutObjectCommand|new Float32Array\(gaussianData\)|editKey = nif\.r2_key\.replace/,
  'the legacy route must never overwrite a NIF key with raw float bytes');
console.log('Backend measurement persistence and NIF edit safety contract passed.');
