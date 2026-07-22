const params = new URLSearchParams(location.search);
const quality = params.get('quality') || (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'mobile' : 'full');
document.documentElement.setAttribute('data-quality', quality);

const perf = window._fumocaPerformance || {};
perf.quality = quality;
perf.mobileReducedFx = perf.mobileReducedFx ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
perf.pointBudget = quality === 'mobile' ? 250000 : (perf.pointBudget || 500000);
perf.progressiveLoading = true;
window._fumocaPerformance = perf;

if (quality === 'mobile') {
  document.documentElement.style.setProperty('--focus-feather', '8%');
  document.documentElement.style.setProperty('--outer-opacity', '0.22');
}
