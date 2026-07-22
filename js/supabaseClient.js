import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runtimeConfig } from './runtime-config.js';

const SUPABASE_URL     = runtimeConfig.supabaseUrl;
const SUPABASE_ANON_KEY= runtimeConfig.supabaseAnonKey;

const _isPlaceholder = !SUPABASE_URL || !SUPABASE_ANON_KEY
  || SUPABASE_URL.includes('YOUR_PROJECT')
  || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE');

if (_isPlaceholder) {
  console.warn('[FUMOCA] Supabase credentials not configured. Check config.js has supabaseUrl and supabaseAnonKey set.');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

window.supabase = supabase;
window.FUMOCA_RUNTIME_CONFIG = runtimeConfig;
