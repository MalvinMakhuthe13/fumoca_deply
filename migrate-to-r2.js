/**
 * FUMOCA Storage Migration: Supabase → Cloudflare R2
 * ════════════════════════════════════════════════════════════
 * Runs once from your terminal (Node.js).
 * Fetches every file URL from Supabase DB, downloads from
 * Supabase Storage, re-uploads to R2, updates DB row.
 *
 * Usage:
 *   node migrate-to-r2.js
 *
 * Requirements:
 *   npm install @supabase/supabase-js node-fetch
 * ════════════════════════════════════════════════════════════
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// ── Config — fill these in ────────────────────────────────────────────────────
const SUPABASE_URL      = 'https://sjxkgdaaknflnviwjbej.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // set via env var
const R2_WORKER_URL     = 'https://fumoca-r2-storage.fumocaapp.workers.dev';
const FUMOCA_API_SECRET = process.env.FUMOCA_API_SECRET;       // set via env var

// ── Bucket → R2 bucket mapping ────────────────────────────────────────────────
const BUCKET_MAP = {
  'splat-files':    'splat-files',
  'splats':         'splat-files',
  'splat-videos':   'splat-videos',
  'preview-videos': 'preview-videos',
  'thumbnails':     'thumbnails',
  'avatars':        'avatars',
};

// ── DB columns to scan per table ─────────────────────────────────────────────
const TABLES = [
  {
    table: 'splats',
    columns: ['splat_url', 'output_url', 'file_url', 'ply_url', 'video_url', 'thumbnail_url', 'preview_video_url', 'external_splat_url', 'provider_splat_url'],
    idCol: 'id',
  },
  {
    table: 'profiles',
    columns: ['avatar_url'],
    idCol: 'id',
  },
  {
    table: 'processing_jobs',
    columns: ['video_url'],
    idCol: 'id',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function extractBucketAndPath(supabaseUrl) {
  // Matches: .../storage/v1/object/public/<bucket>/<path>
  const match = supabaseUrl?.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?.*)?$/);
  if (!match) return null;
  return { bucket: match[1], path: decodeURIComponent(match[2]) };
}

function isSupabaseUrl(url) {
  return url && url.includes('supabase.co/storage');
}

async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}: ${url}`);
  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  return { buffer, contentType };
}

async function uploadToR2(bucket, path, buffer, contentType) {
  // 1. Get presigned URL
  const presignRes = await fetch(`${R2_WORKER_URL}/upload/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Fumoca-Secret': FUMOCA_API_SECRET,
    },
    body: JSON.stringify({ bucket, path, contentType }),
  });

  if (!presignRes.ok) {
    const err = await presignRes.text();
    throw new Error(`Presign failed: ${err}`);
  }

  const { uploadUrl, publicUrl } = await presignRes.json();

  // 2. Upload file
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      ...(uploadUrl.includes('/upload/') ? { 'X-Fumoca-Secret': FUMOCA_API_SECRET } : {}),
    },
    body: Buffer.from(buffer),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`R2 PUT failed: ${err}`);
  }

  return publicUrl;
}

// ── Main migration ─────────────────────────────────────────────────────────────
async function migrate() {
  if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ Set SUPABASE_SERVICE_KEY env var (use service role key from Supabase dashboard)');
    process.exit(1);
  }
  if (!FUMOCA_API_SECRET) {
    console.error('❌ Set FUMOCA_API_SECRET env var (same value you set via wrangler secret put)');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  let totalFiles = 0;
  let migratedFiles = 0;
  let skippedFiles = 0;
  let errorFiles = 0;
  const errors = [];

  console.log('🚀 FUMOCA Storage Migration: Supabase → R2');
  console.log('════════════════════════════════════════════\n');

  for (const { table, columns, idCol } of TABLES) {
    console.log(`📋 Scanning table: ${table}`);

    // Fetch all rows (paginate if needed)
    let allRows = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from(table)
        .select([idCol, ...columns].join(','))
        .range(from, from + pageSize - 1);

      if (error) {
        console.warn(`  ⚠️  Could not read ${table}: ${error.message}`);
        break;
      }
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    console.log(`  Found ${allRows.length} rows\n`);

    for (const row of allRows) {
      for (const col of columns) {
        const url = row[col];
        if (!url || !isSupabaseUrl(url)) continue;

        totalFiles++;
        const extracted = extractBucketAndPath(url);
        if (!extracted) {
          console.warn(`  ⚠️  Could not parse URL: ${url}`);
          skippedFiles++;
          continue;
        }

        const { bucket, path } = extracted;
        const r2Bucket = BUCKET_MAP[bucket] || bucket;
        const label = `${table}.${col} [${row[idCol]}] → ${bucket}/${path}`;

        try {
          process.stdout.write(`  ⬇️  Downloading ${path.slice(-40)}...`);
          const { buffer, contentType } = await downloadFile(url);

          process.stdout.write(` ⬆️  Uploading to R2...`);
          const r2Url = await uploadToR2(r2Bucket, path, buffer, contentType);

          // Update DB row
          const update = { [col]: r2Url };
          const { error: updateError } = await supabase
            .from(table)
            .update(update)
            .eq(idCol, row[idCol]);

          if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

          console.log(` ✅`);
          migratedFiles++;

        } catch (e) {
          console.log(` ❌ ${e.message}`);
          errorFiles++;
          errors.push({ label, error: e.message });
        }
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log('📊 Migration Summary');
  console.log(`  Total files found:  ${totalFiles}`);
  console.log(`  ✅ Migrated:        ${migratedFiles}`);
  console.log(`  ⏭️  Skipped:         ${skippedFiles}`);
  console.log(`  ❌ Errors:          ${errorFiles}`);

  if (errors.length > 0) {
    console.log('\n⚠️  Errors:');
    errors.forEach(e => console.log(`  • ${e.label}\n    ${e.error}`));
  }

  if (migratedFiles === totalFiles - skippedFiles) {
    console.log('\n🎉 Migration complete! All files moved to R2.');
    console.log('   You can now delete the Supabase storage buckets to free quota.');
  } else {
    console.log('\n⚠️  Some files failed. Re-run the script to retry — it skips already-migrated URLs.');
  }
}

migrate().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
