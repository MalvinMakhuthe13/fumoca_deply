/**
 * FUMOCA runtime config — copy this file to config.js and fill in real values.
 * config.js is gitignored and must never be committed.
 *
 * Supabase anon key is designed to be public (RLS protects the data).
 * Never put service-role keys or R2 secrets here.
 */
window.FUMOCA_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR_SUPABASE_ANON_KEY',

  // Optional — shown on upload success / processing pages
  kaggleNotebookUrl: 'https://www.kaggle.com/code/YOUR_USERNAME/YOUR_NOTEBOOK',

  // Your public site origin (used for share links, OG, embeds)
  siteBaseUrl: 'https://your-site-domain.com',

  // Cloudflare Worker that proxies R2 with Supabase session auth
  r2WorkerUrl: 'https://your-r2-worker.workers.dev'
};
