import { NIFHeader, NIFChunk, NIFWriter, NIFReader, NIFCertificate, CHUNK, CODEC, CRS, ENCODER_TIER, crc32,
  encodeCalibrationChunk, decodeCalibrationChunk, encodeVerificationChunk, decodeVerificationChunk, encodeInteractionChunk, decodeInteractionChunk }
  from '../format/NIFSpec.js';
import { SPAX_CHUNK } from '../format/SPAXSpec.js';

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
check('version correct', reader.header.versionMajor === 1 && reader.header.versionMinor === 1);
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

// --- TEST 8: CALIBRATION chunk round-trips exactly, including confidence ---
// This is the chunk verified_for_measurement depends on — if confidence
// silently degrades or flips across encode/decode, a file could be treated
// as trustworthy when it isn't (or vice versa).
const calibIn = { method: 'aruco_marker', scale_factor: 0.0142, confidence: 'high',
                   units: 'meters', note: '50mm ArUco marker, 1 detection' };
const calibChunk = encodeCalibrationChunk(calibIn);
const calibOut = await decodeCalibrationChunk(calibChunk);
check('CALIBRATION round-trips method/scale/confidence exactly',
  calibOut.method === calibIn.method && calibOut.scale_factor === calibIn.scale_factor
  && calibOut.confidence === calibIn.confidence, JSON.stringify(calibOut));

// --- TEST 9: missing CALIBRATION chunk decodes to explicit "uncalibrated", never metric ---
// Guards the exact bug estimate_scale() was written to prevent: an absent
// chunk must never be silently interpreted as "metres."
const noCalib = await decodeCalibrationChunk(null);
check('missing CALIBRATION decodes to confidence=none, units=unknown (never assumes metric)',
  noCalib.confidence === 'none' && noCalib.units === 'unknown', JSON.stringify(noCalib));

// --- TEST 10: VERIFICATION chunk round-trips pass/fail + dimensionally_trustworthy ---
const verifyIn = { aligned: true, pass: true, dimensionally_trustworthy: true, rmse: 0.4,
                    mean_deviation: 0.31, max_deviation: 1.8, tolerance_mm: 2.0,
                    pct_vertices_within_tolerance: 97.2, units: 'mm' };
const verifyChunk = encodeVerificationChunk(verifyIn);
const verifyOut = await decodeVerificationChunk(verifyChunk);
check('VERIFICATION round-trips pass/dimensionally_trustworthy exactly',
  verifyOut.pass === verifyIn.pass && verifyOut.dimensionally_trustworthy === verifyIn.dimensionally_trustworthy
  && verifyOut.tolerance_mm === verifyIn.tolerance_mm, JSON.stringify(verifyOut));

// --- TEST 11: missing VERIFICATION chunk decodes to null, never a false pass ---
// A viewer/app that forgets to null-check could otherwise render an
// unverified file as if it passed verification.
const noVerify = await decodeVerificationChunk(null);
check('missing VERIFICATION decodes to null (never {pass:true} by accident)',
  noVerify === null, JSON.stringify(noVerify));

// --- TEST 12: version gate — mismatched major version is flagged, not silently accepted ---
const goodBuf = writer.build().buffer.slice(0);
const badVersionBuf = goodBuf.slice(0);
new DataView(badVersionBuf).setUint8(4, 2); // corrupt versionMajor to 2
const badVersionReader = new NIFReader(badVersionBuf);
check('unsupported major version: isVersionSupported=false', badVersionReader.isVersionSupported === false);
check('unsupported major version: surfaces via isCorrupted (existing callers already check this)',
  badVersionReader.isCorrupted === true);

// --- TEST 13: matching major version, different minor — must NOT be flagged ---
// (Minor bumps only add chunk types per spec §12; a v1.0 reader given a v1.1
// file, or vice versa, is a supported, ordinary case.)
const okMinorBuf = goodBuf.slice(0);
new DataView(okMinorBuf).setUint8(5, 0); // set versionMinor to 0 (this file was built as 1.1)
const okMinorReader = new NIFReader(okMinorBuf);
check('same major, different minor version: isVersionSupported=true', okMinorReader.isVersionSupported === true);

// --- TEST 14: .nif/.spax shared-concept chunk IDs cannot drift apart ---
// SPAX_CHUNK imports these three directly from NIFSpec.js's CHUNK — this
// test would fail immediately if a future edit ever hardcoded a literal
// back into either enum instead of keeping the shared import.
/* --- INTERACTION binary chunk round-trip --- */
const interactionPortable = {
  triggers: {
    wheel: [
      { event: 'click', actionId: 'showDamage' },
      { event: 'hover', actionId: 'highlightWheel' },
    ],
  },
  actions: {
    showDamage: {
      type: 'run_script',
      payload: { scriptId: 'damageReport' },
    },
    highlightWheel: {
      type: 'trigger_animation',
      payload: { animationId: 'wheelHighlight' },
    },
  },
  machines: {
    doorState: {
      states: [
        { id: 'closed' },
        { id: 'open' },
      ],
      transitions: [
        { from: 'closed', to: 'open', event: 'open' },
        { from: 'open', to: 'closed', event: 'close' },
      ],
      initial: 'closed',
    },
  },
};

const interactionChunk = encodeInteractionChunk(interactionPortable);
const interactionWriter = new NIFWriter({
  captureMode: 'video',
  crs: CRS.WGS84,
  frameCount: 1,
  duration: 0,
  fps: 1,
  originLat: 0,
  originLon: 0,
  originAlt: 0,
  vertical: 'automotive',
});

interactionWriter.add(
  CHUNK.INTERACTION,
  interactionChunk.data,
  CODEC.RAW
);

const interactionBytes = interactionWriter.build();
const interactionReader = new NIFReader(interactionBytes.buffer);
const decodedInteraction = await decodeInteractionChunk(
  interactionReader.getChunk(CHUNK.INTERACTION)
);

check(
  'INTERACTION chunk is written to NIF',
  interactionReader.hasChunk(CHUNK.INTERACTION)
);

check(
  'INTERACTION trigger survives binary round-trip',
  decodedInteraction.triggers.wheel?.some(
    t => t.event === 'click' && t.actionId === 'showDamage'
  ) === true
);

check(
  'INTERACTION action survives binary round-trip',
  decodedInteraction.actions.showDamage?.type === 'run_script' &&
  decodedInteraction.actions.showDamage?.payload?.scriptId === 'damageReport'
);

check(
  'INTERACTION state machine survives binary round-trip',
  decodedInteraction.machines.doorState?.initial === 'closed' &&
  decodedInteraction.machines.doorState?.states?.length === 2 &&
  decodedInteraction.machines.doorState?.transitions?.length === 2
);
check('SPATIAL_AUDIO shares one ID across .nif and .spax', SPAX_CHUNK.SPATIAL_AUDIO === CHUNK.SPATIAL_AUDIO);
check('EDIT_HISTORY shares one ID across .nif and .spax', SPAX_CHUNK.EDIT_HISTORY === CHUNK.EDIT_HISTORY);
check('INTERACTION shares one ID across .nif and .spax', SPAX_CHUNK.INTERACTION === CHUNK.INTERACTION);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
