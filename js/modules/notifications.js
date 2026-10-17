import { supabase } from '../supabaseClient.js';

let loading = false;

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text == null ? '' : String(text);
  return node;
}

function normalizeStatus(status) {
  const raw = String(status || 'unknown').toLowerCase();
  if (['done', 'ready', 'published', 'complete', 'completed', 'succeeded', 'success'].includes(raw)) return 'Completed';
  if (['failed', 'failed_reconstruction', 'error'].includes(raw)) return 'Failed';
  if (['cancelled', 'canceled'].includes(raw)) return 'Cancelled';
  if (['processing', 'running', 'training', 'rendering'].includes(raw)) return 'Processing';
  if (raw === 'staged') return 'Staged — not queued';
  if (['queued', 'pending', 'waiting'].includes(raw)) return 'Queued';
  return raw.replaceAll('_', ' ');
}

async function loadNifJobs(userId) {
  return supabase
    .from('reconstruction_jobs')
    .select('id,user_id,status,progress,created_at,started_at,completed_at,error_message,meta,capture_mode')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(12);
}

async function loadLegacyJobs(userId) {
  return supabase
    .from('processing_jobs')
    .select('*')
    .eq('user_id', userId)
    .order('queued_at', { ascending: false })
    .limit(12);
}

function toDisplayJob(job, source) {
  const meta = job?.meta && typeof job.meta === 'object' ? job.meta
    : job?.metadata && typeof job.metadata === 'object' ? job.metadata : {};
  return {
    ...job,
    _source: source,
    _created: job?.created_at || job?.queued_at || job?.createdAt || null,
    _title: meta.title || job?.title || job?.file_name || job?.video_filename || 'Reconstruction job',
    _status: normalizeStatus(job?.status),
  };
}

async function init() {
  if (loading) return;
  loading = true;
  const wrap = document.getElementById('notificationsList');
  if (!wrap) { loading = false; return; }

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const user = authData?.user;
    if (!user) { window.location.href = 'login.html'; return; }

    // NIF is the primary worker contract. Also read the legacy queue while it
    // remains deployed so older jobs don't disappear during the migration.
    const [nifResult, legacyResult] = await Promise.all([
      loadNifJobs(user.id).catch(error => ({ data: null, error })),
      loadLegacyJobs(user.id).catch(error => ({ data: null, error })),
    ]);
    const jobs = [
      ...(!nifResult.error ? (nifResult.data || []).map(job => toDisplayJob(job, 'NIF')) : []),
      ...(!legacyResult.error ? (legacyResult.data || []).map(job => toDisplayJob(job, 'Legacy')) : []),
    ];
    const unique = new Map();
    for (const job of jobs) {
      const key = String(job.id || '') + ':' + job._source;
      if (!unique.has(key)) unique.set(key, job);
    }
    const items = [...unique.values()].sort((a, b) => {
      const ta = Date.parse(a._created || '') || 0;
      const tb = Date.parse(b._created || '') || 0;
      return tb - ta;
    }).slice(0, 12);

    wrap.replaceChildren();
    if (!items.length) {
      if (nifResult.error && legacyResult.error) {
        wrap.appendChild(textNode('div', 'empty-state', 'Could not load processing jobs. Check the deployed database schema and access policies, then retry.'));
      } else {
        wrap.appendChild(textNode('div', 'empty-state', 'No processing jobs yet. Upload a capture to start a reconstruction.'));
      }
      if (nifResult.error) console.warn('[notifications] NIF job query failed:', nifResult.error.message || nifResult.error);
      if (legacyResult.error) console.info('[notifications] Legacy job queue unavailable:', legacyResult.error.message || legacyResult.error);
      return;
    }

    for (const job of items) {
      const item = textNode('div', 'mini-item', '');
      const title = textNode('div', 'mini-item-title', job._title + ' · ' + job._status);
      const details = [];
      if (job._created) {
        const date = new Date(job._created);
        details.push(Number.isNaN(date.getTime()) ? String(job._created) : date.toLocaleString());
      }
      if (Number.isFinite(Number(job.progress))) details.push('Progress ' + Math.max(0, Math.min(100, Number(job.progress))) + '%');
      details.push(job._source === 'NIF' ? 'NIF pipeline' : 'Legacy pipeline');
      const subtitle = textNode('div', 'mini-item-sub', details.join(' · '));
      item.append(title, subtitle);
      if (job.meta?.status_message) item.appendChild(textNode('div', 'mini-item-sub', job.meta.status_message));
      if (job.error_message) item.appendChild(textNode('div', 'mini-item-sub', 'Error: ' + job.error_message));
      wrap.appendChild(item);
    }
    if (nifResult.error) console.warn('[notifications] NIF job query failed:', nifResult.error.message || nifResult.error);
    if (legacyResult.error) console.info('[notifications] Legacy job queue unavailable:', legacyResult.error.message || legacyResult.error);
  } catch (error) {
    wrap.replaceChildren(textNode('div', 'empty-state', 'Failed to load processing updates: ' + (error?.message || String(error))));
  } finally {
    loading = false;
  }
}

init();
window.setInterval(init, 10000);

export { normalizeStatus };
