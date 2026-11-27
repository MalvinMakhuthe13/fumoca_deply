#!/usr/bin/env node
/**
 * Download the 3D libraries Fumoca depends on into vendor/<name>/<version>/
 * so the site serves them itself (no CDN outage can take Studio or the viewer
 * down). Runs in CI (needs network): .github/workflows/vendor-libs.yml
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const cfg = JSON.parse(readFileSync(join(root, 'vendor/VERSIONS.json'), 'utf8'));
const manifest = { generated: new Date().toISOString(), packages: [] };

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) { const p = join(dir, f); statSync(p).isDirectory() ? walk(p, out) : out.push(p); }
  return out;
}

for (const pkg of cfg.packages) {
  // No '@' in served paths: the host does not serve folders named like '@scope'.
  const dest = join(root, 'vendor', pkg.name.replace(/^@/, '').replace('/', '-'), pkg.version);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'vendor-'));
  let copied = 0;
  try {
    const tgz = execFileSync('npm', ['pack', `${pkg.name}@${pkg.version}`, '--silent', '--pack-destination', work], { encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['-xzf', join(work, tgz), '-C', work]);
    const src = join(work, 'package');
    for (const rel of pkg.copy) {
      if (!existsSync(join(src, rel))) continue;
      cpSync(join(src, rel), join(dest, rel), { recursive: true });
      copied++;
    }
  } catch (e) {
    console.warn(`npm pack failed for ${pkg.name}@${pkg.version}: ${e.message}`);
  }
  if (!copied && pkg.fallbackUrl) {
    const res = await fetch(pkg.fallbackUrl);
    if (!res.ok) throw new Error(`Could not download ${pkg.fallbackUrl}: ${res.status}`);
    mkdirSync(join(dest, 'dist'), { recursive: true });
    writeFileSync(join(dest, 'dist', pkg.fallbackUrl.split('/').pop()), Buffer.from(await res.arrayBuffer()));
    copied++;
  }
  if (!copied) throw new Error(`Nothing vendored for ${pkg.name}@${pkg.version}`);
  const files = walk(dest).map(f => ({ path: relative(root, f), bytes: statSync(f).size, sha256: createHash('sha256').update(readFileSync(f)).digest('hex') }));
  manifest.packages.push({ name: pkg.name, version: pkg.version, files: files.length, bytes: files.reduce((s, f) => s + f.bytes, 0) });
  writeFileSync(join(dest, 'MANIFEST.json'), JSON.stringify(files, null, 1));
  console.log(`vendored ${pkg.name}@${pkg.version}: ${files.length} files`);
  rmSync(work, { recursive: true, force: true });
}
writeFileSync(join(root, 'vendor/MANIFEST.json'), JSON.stringify(manifest, null, 2));
