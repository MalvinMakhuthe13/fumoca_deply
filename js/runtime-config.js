const raw = window.FUMOCA_CONFIG || {};

export const runtimeConfig = {
  supabaseUrl: window.FUMOCA_SUPABASE_URL || raw.supabaseUrl || raw.SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co',
  supabaseAnonKey: window.FUMOCA_SUPABASE_ANON_KEY || raw.supabaseAnonKey || raw.SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY',
  kaggleNotebookUrl: (window.FUMOCA_KAGGLE_NOTEBOOK_URL || raw.kaggleNotebookUrl || '').replace(/\/$/, ''),
  siteBaseUrl: (window.FUMOCA_SITE_BASE_URL || raw.siteBaseUrl || window.location.origin).replace(/\/$/, '')
};
