import { NIFHeader, NIFChunk, NIFWriter, NIFReader, NIFCertificate, CHUNK, CODEC, CRS, ENCODER_TIER, crc32 }
  from '../format/NIFSpec.js';

let pass = 0, fail = 0;
function check(name, cond, detail='') {
  if (cond) { pass++; console.log('PASS:', name); }
  else { fail++; console.log('FAIL:', name, detail); }
}

// --- TEST 1: header round-trip preserves all fields ---
const writer = new NIFWriter({
  captureMode: 'video', crs: CRS.WGS84, frameCount: 120, duration: 4.0, fps: 30,
  originLat: -26.2041, originLon: 28.0473, originAlt: 1753.0, vertical: 'automotive',
});

// realistic-ish geometry chunk: 100 points * 14 floats each (per spec comment)
const nPoints = 100;
const geoFloats = new Float32Array(nPoints * 14);
for (let i = 0; i < geoFloats.length; i++) geoFloats[i] = Math.sin(i) * 10;
writer.add(CHUNK.KEYFRAME_GEO, new Uint8Array(geoFloats.buffer), CODEC.RAW);

// material chunk
const materialJson = JSON.stringify({ albedo: [0.8, 0.2, 0.1], roughness: 0.4, metallic: 0.0 });
writer.add(CHUNK.MATERIAL, new TextEncoder().encode(materialJson), CODEC.RAW);

// timeline chunk
const timelineJson = JSON.stringify({ keyframes: [0, 1.0, 2.0, 3.5], interp: 'catmull-rom' });
writer.add(CHUNK.TIMELINE, new TextEncoder().encode(timelineJson), CODEC.RAW);

// signed certificate (COMMERCIAL tier)
const rawKey = crypto.getRandomValues(new Uint8Array(32));
const cert = await NIFCertificate.sign({
  tier: ENCODER_TIER.COMMERCIAL, encoderId: 'FUMOCA-ENC-001', licenseeId: 'Ntuthuko Dev',
  issuedAt: Math.floor(Date.now()/1000), expiresAt: 0,
}, rawKey);
writer.chunks.push(cert.toChunk());

const bytes = writer.build();
check('writer produces a byte buffer', bytes instanceof Uint8Array && bytes.length > 256);
check('total byteLength matches writer.byteLength getter', bytes.length === writer.byteLength, `${bytes.length} vs ${writer.byteLength}`);

// --- TEST 2: read it back ---
const reader = new NIFReader(bytes.buffer);
check('magic number correct', reader.header.magic === 0x4E494600);
check('version correct', reader.header.versionMajor === 1 && reader.header.versionMinor === 0);
check('captureMode round-trips', reader.header.captureMode === 'video', reader.header.captureMode);
check('vertical round-trips', reader.header.vertical === 'automotive', reader.header.vertical);
check('frameCount round-trips', reader.header.frameCount === 120, reader.header.frameCount);
check('fps round-trips', reader.header.fps === 30, reader.header.fps);
check('duration round-trips (float32 precision)', Math.abs(reader.header.duration - 4.0) < 0.001, reader.header.duration);
check('originLat round-trips (float64 precision)', Math.abs(reader.header.originLat - (-26.2041)) < 1e-9, reader.header.originLat);
check('originLon round-trips (float64 precision)', Math.abs(reader.header.originLon - 28.0473) < 1e-9, reader.header.originLon);
check('chunk count correct', reader.chunks.length === 4, reader.chunks.length);

// --- TEST 3: chunk data integrity ---
const geoChunk = reader.getChunk(CHUNK.KEYFRAME_GEO);
const readGeo = new Float32Array(geoChunk.data.buffer, geoChunk.data.byteOffset, nPoints*14);
let geoMatches = true;
for (let i = 0; i < geoFloats.length; i++) if (readGeo[i] !== geoFloats[i]) { geoMatches = false; break; }
check('geometry chunk data byte-exact round-trip', geoMatches);

const matChunk = reader.getChunk(CHUNK.MATERIAL);
const readMat = JSON.parse(new TextDecoder().decode(matChunk.data));
check('material chunk round-trips', readMat.roughness === 0.4 && readMat.albedo[0] === 0.8);

check('hasChunk/allChunks work', reader.hasChunk(CHUNK.TIMELINE) && reader.allChunks(CHUNK.MATERIAL).length === 1);

// --- TEST 4: certificate round-trip + HMAC verification ---
const readCert = reader.getCertificate();
check('certificate present', !!readCert);
check('certificate tier round-trips', readCert.tier === ENCODER_TIER.COMMERCIAL);
check('certificate encoderId round-trips', readCert.encoderId === 'FUMOCA-ENC-001', readCert.encoderId);
check('certificate isActive()', readCert.isActive());
const validSig = await readCert.verify(rawKey);
check('HMAC signature verifies with correct key', validSig === true);
const wrongKey = crypto.getRandomValues(new Uint8Array(32));
const invalidSig = await readCert.verify(wrongKey);
check('HMAC signature REJECTS wrong key', invalidSig === false);

// --- TEST 5: corruption detection ---
const corrupted = new Uint8Array(bytes);
// flip a byte inside the first chunk's DATA region (offset 256 + 16 header = 273)
corrupted[290] ^= 0xFF;
const corruptReader = new NIFReader(corrupted.buffer);
const corruptionCaught = corruptReader.isCorrupted === true && corruptReader.errors.length === 1;
check('corrupted chunk data is caught and flagged via reader.isCorrupted (not thrown - graceful degradation)', corruptionCaught);

// --- TEST 6: truncated file handling ---
let truncationHandled = false;
try {
  const truncated = bytes.slice(0, 200); // shorter than 256-byte header
  new NIFReader(truncated.buffer);
} catch (e) {
  truncationHandled = /Too short/.test(e.message);
}
check('truncated header throws clear error', truncationHandled);

// --- TEST 7: wrong magic number rejected ---
let badMagicCaught = false;
try {
  const badMagic = new Uint8Array(bytes);
  badMagic[0] = 0x00; // corrupt magic
  new NIFReader(badMagic.buffer);
} catch (e) {
  badMagicCaught = /Invalid NIF magic/.test(e.message);
}
check('wrong magic number rejected', badMagicCaught);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
