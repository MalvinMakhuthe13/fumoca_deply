
const fs = require("fs");
const path = require("path");

const root = process.cwd();
const output = path.join(root, "dist-site");
const MAX_BYTES = 25 * 1024 * 1024;

// Skipped anywhere in the tree.
const excludedDirs = new Set([
  ".git", ".wrangler", ".pytest_cache", "node_modules"
]);
// Skipped only at the top level. Library folders such as
// vendor/sparkjsdev-spark/2.4.0/dist/ must still be published.
const excludedTopDirs = new Set([
  "third_party", "engine-next", "test-artifacts",
  "kaggle", "cloudflare", "dist", "dist-site",
  "scripts"
]);

const excludedFiles = new Set([
  ".gitignore", ".gitmodules",
  "package.json", "package-lock.json",
  "DEPLOY.md", "DEPLOYMENT.md", "INSTALL.txt",
  "README.md", "FUMOCA_BIBLE.md", "VISION.md",
  "KAGGLE_SETUP.md",
  "fumoca_feature_pack.zip", "fumoca_merged_FIXED (2).zip",
  "wrangler.jsonc", "worker-configuration.d.ts",
  "config.example.js", "migrate-to-r2.js",
  "supabase_migration_commerce.sql",
  "supabase_migration_embeds.sql",
  "supabase_schema.sql", "supabase_storage_policies.sql"
]);

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, {
    withFileTypes: true
  })) {
    const name = entry.name;
    const src = path.join(source, name);
    const dest = path.join(destination, name);

    if (entry.isDirectory()) {
      if (
        excludedDirs.has(name) ||
        (source === root && excludedTopDirs.has(name)) ||
        name.startsWith(".venv") ||
        (name.startsWith(".") && name !== ".well-known")
      ) {
        continue;
      }

      copyTree(src, dest);
      continue;
    }

    if (!entry.isFile() || excludedFiles.has(name)) {
      continue;
    }

    if (
      /\.(log|txt|sql|d\.ts|jsonc)$/i.test(name) ||
      /\.before[-_]/i.test(name) ||
      /\.backup[-_]/i.test(name)
    ) {
      continue;
    }

    const size = fs.statSync(src).size;

    if (size > MAX_BYTES) {
      console.log(`Skipped oversized file: ${name} (${size} bytes)`);
      continue;
    }

    fs.copyFileSync(src, dest);
  }
}

fs.rmSync(output, { recursive: true, force: true });
copyTree(root, output);

for (const required of [
  "index.html",
  "_redirects",
  "_headers",
  "viewer.html",
  "viewer-core.html"
]) {
  if (!fs.existsSync(path.join(output, required))) {
    throw new Error(`Required website file missing: ${required}`);
  }
}


// Self-hosted 3D libraries: without these the photoreal view, moving parts
// and physics silently fall back (the server answers with an HTML page).
for (const lib of [
  "vendor/sparkjsdev-spark/2.4.0/dist/spark.module.js",
  "vendor/three/0.180.0/build/three.module.js",
  "vendor/dimforge-rapier3d-compat/0.21.0/dist/rapier.mjs"
]) {
  if (!fs.existsSync(path.join(output, lib))) {
    throw new Error(`Required 3D library missing from the site: ${lib}`);
  }
}

const requiredEngineFiles = [
  ["engine-next/format/NIFSpec.js", "engine-next/format/NIFSpec.js"],
  ["engine-next/math/NIFMath.js", "engine-next/math/NIFMath.js"]
];

for (const [source, relativeDestination] of requiredEngineFiles) {
  const sourcePath = path.join(root, source);
  const destinationPath = path.join(output, relativeDestination);

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Required engine module missing: ${source}`);
  }

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);

  console.log(`Included engine module: ${relativeDestination}`);
}

console.log(`Pages output prepared: ${output}`);

