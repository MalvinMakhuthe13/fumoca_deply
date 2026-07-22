const key = `fumoca_analytics_${location.pathname}`;
const state = { events: [], startedAt: Date.now() };

function persist() {
  try {
    localStorage.setItem(key, JSON.stringify({ events: state.events.slice(-250), startedAt: state.startedAt }));
  } catch (_) {}
}

function track(detail = {}) {
  const event = { t: new Date().toISOString(), path: location.pathname, ...detail };
  state.events.push(event);
  persist();
  window._fumocaAnalytics = {
    list: () => state.events.slice(),
    summary: () => state.events.reduce((acc, e) => { acc[e.event || 'unknown'] = (acc[e.event || 'unknown'] || 0) + 1; return acc; }, {}),
    last: () => state.events[state.events.length - 1] || null,
  };
}

window.addEventListener('fumoca:track', (e) => track(e.detail || {}));
window.addEventListener('fumoca:viewerReady', () => track({ event: 'viewer_ready' }));
window.addEventListener('fumoca:recordLoaded', () => track({ event: 'record_loaded' }));
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') track({ event: 'viewer_hidden' });
});
track({ event: 'viewer_boot' });
