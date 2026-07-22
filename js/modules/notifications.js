import { supabase } from '../supabaseClient.js';

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = 'login.html'; return; }

  const { data: jobs, error } = await supabase
    .from('processing_jobs')
    .select('*')
    .eq('user_id', user.id)
    .order('queued_at', { ascending: false })
    .limit(12);

  const wrap = document.getElementById('notificationsList');
  if (error) {
    wrap.innerHTML = `<div class="empty-state">Failed to load notifications: ${error.message}</div>`;
    return;
  }
  if (!jobs || !jobs.length) {
    wrap.innerHTML = '<div class="empty-state">No notifications yet. Processing updates will appear here.</div>';
    return;
  }
  wrap.innerHTML = jobs.map(job => `
    <div class="mini-item">
      <div class="mini-item-title">Processing job ${job.status}</div>
      <div class="mini-item-sub">Queued: ${new Date(job.queued_at).toLocaleString()}${job.error_message ? ' · ' + job.error_message : ''}</div>
    </div>
  `).join('');
}
init();

setInterval(init, 10000);
