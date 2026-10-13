import { supabase } from './supabaseClient.js';

/**
 * Sign up with email + password.
 * @returns {{ data, error }}
 */
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    console.error('[auth] signUp', error);
    return { data: null, error };
  }
  return { data, error: null };
}

/**
 * Sign in with email + password.
 * On success redirects to index/feed.
 * @returns {{ data, error }}
 */
export async function login(email, password, redirectTo = 'feed.html') {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error('[auth] login', error);
    return { data: null, error };
  }
  window.location.href = redirectTo;
  return { data, error: null };
}

/**
 * Sign out and redirect to login.
 */
export async function logout(redirectTo = 'login.html') {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('[auth] logout', error);
  window.location.href = redirectTo;
}

/**
 * Current session helper.
 */
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    console.error('[auth] getSession', error);
    return null;
  }
  return session;
}
