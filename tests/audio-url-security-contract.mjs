import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scene = await readFile(new URL('../js/modules/scene-audio.js', import.meta.url), 'utf8');
assert.match(scene, /function safeMediaUrl\(value\)/, 'scene audio must validate metadata URLs');
assert.match(scene, /const bedUrl = safeMediaUrl\(config\?\.bed\?\.url\)/, 'scene ambience must validate its URL');
assert.match(scene, /const safeUrl = safeMediaUrl\(url\)/, 'one-shot scene audio must validate its URL');

const engine = await readFile(new URL('../js/modules/4d-engine.js', import.meta.url), 'utf8');
assert.match(engine, /const audioUrl = safeMediaUrl\(record\?\.ambient_audio_url\)/, '4D ambient audio must validate metadata URLs');

const manager = await readFile(new URL('../js/modules/fumoc-sound-manager.js', import.meta.url), 'utf8');
assert.match(manager, /function safeMediaUrl\(value\)/, 'sound manager must have a shared URL validator');
assert.match(manager, /const ambientUrl = safeMediaUrl\(sond\?\.ambient\?\.url\)/, 'FUMOC ambience must be validated');
assert.match(manager, /const hotspotAudioUrl = safeMediaUrl\(hotspot\.audioUrl\)/, 'hotspot audio must be validated');
assert.match(manager, /const safeUrl = safeMediaUrl\(url\)/, 'UI sounds must be validated');

const viewer = await readFile(new URL('../viewer-core.html', import.meta.url), 'utf8');
assert.match(viewer, /function safeAudioUrl\(value\)/, 'viewer query and record audio must be validated');
assert.match(viewer, /const safeUrl = safeAudioUrl\(musicUrl\)/, 'background audio must use the validated URL');
console.log('Metadata-driven audio URL security regression checks passed.');
