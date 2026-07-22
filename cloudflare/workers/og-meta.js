/**
 * FUMOCA OG Meta Worker
 * ══════════════════════════════════════════════════════════════════════════════
 * Intercepts requests to viewer.html?id=<splat_id> and rewrites the static
 * <meta> tags with real per-splat data fetched from the Supabase REST API.
 *
 * Without this, social crawlers (WhatsApp, Slack, Twitter, iMessage) see the
 * placeholder "3D Scene — FUMOCA" title and the generic og-default.jpg — the
 * actual record is only loaded by JavaScript after the page hydrates, which
 * crawlers never execute.
 *
 * Deploy
 * ──────
 *   npx wrangler deploy workers/og-meta.js --name fumoca-og-meta
 *
 * Then add a route in wrangler.toml (or via the CF dashboard):
 *   [[routes]]
 *   pattern = "fumoca.co.za/viewer*"
 *   script  = "fumoca-og-meta"
 *
 * Environment variables (set via wrangler secret put):
 *   SUPABASE_URL        — e.g. https://xyzabc.supabase.co
 *   SUPABASE_ANON_KEY   — public anon key (read-only, safe to use here)
 *   SITE_ORIGIN         — e.g. https://fumoca.co.za
 *
 * Caching
 * ───────
 * OG rewrites are cached at the CF edge for 5 minutes (CACHE_TTL). The
 * underlying Supabase fetch is cached for the same duration. Social crawlers
 * re-crawl on every new share, so 5 min is a good tradeoff between freshness
 * and origin load.
 * ══════════════════════════════════════════════════════════════════════════════
 */

const CACHE_TTL       = 60 * 5;          // seconds — CF edge cache
const SUPABASE_TABLE  = 'splats';
const FALLBACK_TITLE  = 'Interactive 3D View — FUMOCA';
const FALLBACK_DESC   = 'Explore this Gaussian Splat in 3D. No app required.';
const FALLBACK_IMAGE  = '/icons/og-default.jpg';   // relative to SITE_ORIGIN

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url    = new URL(request.url);
    const splatId = url.searchParams.get('id');

    // If there's no ?id= this is either a direct open or a bot probing /viewer
    // with no splat — serve the static page as-is (no rewrite needed).
    if (!splatId) {
      return fetch(request);
    }

    // Check CF cache first — keyed on the canonical viewer URL
    const cacheKey = new Request(request.url, request);
    const cache    = caches.default;
    const cached   = await cache.match(cacheKey);
    if (cached) return cached;

    // Fetch the static viewer HTML from the origin in parallel with the
    // Supabase record lookup.
    const [pageRes, meta] = await Promise.all([
      fetch(request),
      fetchSplatMeta(splatId, env),
    ]);

    if (!pageRes.ok) return pageRes; // propagate 404 / 500

    const html    = await pageRes.text();
    const rewritten = rewriteOgTags(html, meta, url.origin || env.SITE_ORIGIN, splatId);

    const response = new Response(rewritten, {
      status:  pageRes.status,
      headers: {
        'Content-Type':  'text/html; charset=UTF-8',
        'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
        'X-Fumoca-OG':   meta.found ? 'hit' : 'miss',
      },
    });

    // Store in CF edge cache — waitUntil so we don't delay the response
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};

// ── Supabase REST fetch ───────────────────────────────────────────────────────
async function fetchSplatMeta(splatId, env) {
  const base = {
    found:       false,
    title:       FALLBACK_TITLE,
    description: FALLBACK_DESC,
    image:       FALLBACK_IMAGE,
  };

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.warn('[og-meta] SUPABASE_URL / SUPABASE_ANON_KEY not set');
    return base;
  }

  try {
    const apiUrl = `${env.SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` +
      `?id=eq.${encodeURIComponent(splatId)}` +
      `&select=id,title,description,thumbnail_url,preview_video_url,metadata` +
      `&limit=1`;

    const res = await fetch(apiUrl, {
      headers: {
        'apikey':        env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Accept':        'application/json',
      },
      // CF: don't cache the Supabase call itself — we cache the full page above
      cf: { cacheTtl: 0 },
    });

    if (!res.ok) {
      console.warn(`[og-meta] Supabase returned ${res.status}`);
      return base;
    }

    const rows = await res.json();
    if (!rows?.length) return base;

    const row = rows[0];
    const siteOrigin = env.SITE_ORIGIN || '';

    // Prefer the teaser/preview video thumbnail if no explicit thumbnail
    const image = row.thumbnail_url
      || row.metadata?.thumbnail_url
      || FALLBACK_IMAGE;

    // Make relative image paths absolute so crawlers can reach them
    const imageAbs = image.startsWith('http')
      ? image
      : `${siteOrigin}${image}`;

    return {
      found:       true,
      title:       row.title       || FALLBACK_TITLE,
      description: row.description || FALLBACK_DESC,
      image:       imageAbs,
    };
  } catch (err) {
    console.error('[og-meta] fetch error:', err.message);
    return base;
  }
}

// ── HTML rewrite ──────────────────────────────────────────────────────────────
function rewriteOgTags(html, meta, origin, splatId) {
  // Public shares link to viewer-core.html (lean SDK viewer, no auth required).
  // The platform dashboard at viewer.html is for authenticated owners only.
  const viewUrl = `${origin}/viewer-core.html?id=${encodeURIComponent(splatId)}`;

  // Escape for HTML attribute values
  const esc = (s) => s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const t = esc(meta.title);
  const d = esc(meta.description);
  const i = esc(meta.image);
  const u = esc(viewUrl);

  // Replace the six static id-targeted tags the viewer embeds.
  // We match on the id= attribute so this is robust to whitespace / ordering.
  const replacements = [
    [/(<meta[^>]+id="meta-og-title"[^>]*content=")[^"]*(")/,   `$1${t}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-og-title")/,   `$1${t}$2`],
    [/(<meta[^>]+id="meta-og-desc"[^>]*content=")[^"]*(")/,    `$1${d}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-og-desc")/,    `$1${d}$2`],
    [/(<meta[^>]+id="meta-og-image"[^>]*content=")[^"]*(")/,   `$1${i}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-og-image")/,   `$1${i}$2`],
    [/(<meta[^>]+id="meta-og-url"[^>]*content=")[^"]*(")/,     `$1${u}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-og-url")/,     `$1${u}$2`],
    [/(<meta[^>]+id="meta-tw-title"[^>]*content=")[^"]*(")/,   `$1${t}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-tw-title")/,   `$1${t}$2`],
    [/(<meta[^>]+id="meta-tw-desc"[^>]*content=")[^"]*(")/,    `$1${d}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-tw-desc")/,    `$1${d}$2`],
    [/(<meta[^>]+id="meta-tw-image"[^>]*content=")[^"]*(")/,   `$1${i}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-tw-image")/,   `$1${i}$2`],
    [/(<meta[^>]+id="meta-desc"[^>]*content=")[^"]*(")/,       `$1${d}$2`],
    [/(<meta[^>]+content=")[^"]*("[^>]+id="meta-desc")/,       `$1${d}$2`],
    // <title> tag
    [/(<title>)[^<]*(<\/title>)/,                               `$1${t}$2`],
  ];

  let out = html;
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
