import { supabase } from '../supabaseClient.js';

async function initShell() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }
  const meta = user.user_metadata || {};
  const name = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || user.email;
  const handle = '@' + (meta.username || user.email.split('@')[0]);
  const avatarText = (meta.first_name || meta.username || user.email || '?')[0].toUpperCase();

  const nameEl = document.getElementById('userName');
  const handleEl = document.getElementById('userHandle');
  const avatarEl = document.getElementById('userAvatar');
  if (nameEl) nameEl.textContent = name;
  if (handleEl) handleEl.textContent = handle;
  if (avatarEl) avatarEl.textContent = avatarText;

  if (window.FumocaNav) {
    window.FumocaNav.setUser({ name, handle, initials: avatarText });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (window.FumocaNav) window.FumocaNav.setUser({ name, handle, initials: avatarText });
    });
  }
}
initShell();
