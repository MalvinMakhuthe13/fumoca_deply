import { supabase } from '../supabaseClient.js';

async function init() {
  const wrap = document.getElementById('notificationsList');
  if (!wrap) return;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData?.user;
  if (authError || !user) {
    window.location.href = 'login.html';
    return;
  }

  // The current capture/upload flow creates reconstruction_jobs. Querying the
  // legacy processing_jobs table made valid NIF jobs invisible on this page.
  const { data: jobs, error } = await supabase
    .from('reconstruction_jobs')
    .select('id,status,progress,created_at,error_message,completed_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(12);

  if (error) {
    renderMessage(wrap, `Failed to load processing updates: ${error.message}`);
    return;
  }
  if (!jobs || !jobs.length) {
    renderMessage(wrap, 'No processing updates yet. New capture and upload jobs will appear here.');
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const job of jobs) {
    const item = document.createElement('div');
    item.className = 'mini-item';

    const title = document.createElement('div');
    title.className = 'mini-item-title';
    title.textContent = `Reconstruction ${job.status || 'unknown'}${Number.isFinite(job.progress) ? ` · ${job.progress}%` : ''}`;

    const sub = document.createElement('div');
    sub.className = 'mini-item-sub';
    const created = job.created_at ? new Date(job.created_at).toLocaleString() : 'Time unavailable';
    sub.textContent = `Created: ${created}${job.error_message ? ` · ${job.error_message}` : ''}`;

    item.append(title, sub);
    fragment.appendChild(item);
  }
  wrap.replaceChildren(fragment);
}

function renderMessage(wrap, message) {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.textContent = message;
  wrap.replaceChildren(empty);
}

init();
setInterval(() => { void init(); }, 10000);
