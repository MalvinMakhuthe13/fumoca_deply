const isMobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
document.documentElement.classList.toggle('fumoca-mobile', isMobile);
document.body?.setAttribute?.('data-mobile', isMobile ? '1' : '0');

if (isMobile) {
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.style.paddingBottom = '12px';
  window._fumocaPerformance = { ...(window._fumocaPerformance || {}), mobileReducedFx: true };
  const compareBtn = document.getElementById('compareBtn');
  if (compareBtn) compareBtn.title = 'Hold briefly to compare';
}
