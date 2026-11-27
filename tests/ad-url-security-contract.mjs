import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const player = await readFile(new URL('../js/modules/fumoc-ad-player.js', import.meta.url), 'utf8');
assert.match(player, /function safeHttpUrl\(value\)/, 'decoded ad CTA needs HTTP(S) validation');
assert.match(player, /const ctaUrl = safeHttpUrl\(_s\.adMeta\?\.cta_url\)/, 'ad metadata CTA must be validated before display');
assert.match(player, /window\.open\(ctaUrl, '_blank', 'noopener,noreferrer'\)/, 'ad CTA must open only the validated URL');
assert.doesNotMatch(player, /window\.open\(_s\.adMeta\.cta_url/, 'raw ad metadata must not reach window.open');

const embed = await readFile(new URL('../embed/fumoca-ad.js', import.meta.url), 'utf8');
assert.match(embed, /function safeHttpUrl\(value\)/, 'embed script needs an HTTP(S) URL validator');
assert.match(embed, /const src\s*= safeHttpUrl\(rawSrc\)/, 'embed source URL must be validated before fetch');
assert.match(embed, /const ctaUrl\s*= safeHttpUrl\(opts\.ctaUrl \|\| container\.dataset\.ctaUrl\)/, 'embed CTA URL must be validated');
assert.match(embed, /_mountVideoOnly\(container, buffer, header, \{ autoplay, ctaUrl, brand, src \}\)/, 'video-only mode must receive the validated CTA value');
assert.match(embed, /_mountFull\(container, buffer, header, \{[\s\S]*?ctaUrl/, 'interactive mode must receive the validated CTA value');
console.log('FUMOCA ad URL security regression checks passed.');
