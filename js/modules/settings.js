import { supabase } from '../supabaseClient.js';

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  document.getElementById('displayName').value = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
  document.getElementById('website').value = profile?.website || '';
  document.getElementById('bio').value = profile?.bio || '';
}
window.saveSettings = async function() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const name = document.getElementById('displayName').value.trim();
  const parts = name.split(' ');
  const first_name = parts[0] || '';
  const last_name = parts.slice(1).join(' ');
  const website = document.getElementById('website').value.trim();
  const bio = document.getElementById('bio').value.trim();

  const { error } = await supabase.from('profiles').upsert({
    id: user.id, first_name, last_name, website, bio
  });

  const msg = document.getElementById('saveMsg');
  if (error) {
    msg.className = 'empty-state';
    msg.textContent = 'Save failed: ' + error.message;
  } else {
    msg.className = 'empty-state';
    msg.textContent = 'Settings saved.';
  }
};
init();
