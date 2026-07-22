/* ============================================================
   FUMOCA — UNIFIED NAVIGATION (single source of truth)

   Every page includes this ONE script. It injects:
     - a mobile topbar with a real hamburger menu
     - a slide-in drawer (mobile) with the full social menu
     - a persistent sidebar (desktop, >900px)
   Nothing about nav markup should be hand-written per-page again —
   edit THIS file to change the menu everywhere at once.

   Usage: <link rel="stylesheet" href="css/tokens.css">
          <link rel="stylesheet" href="css/nav.css">
          <script src="js/modules/nav.js" defer></script>
   Optional: <body data-nav="none"> to skip injection entirely
   (used by full-screen tools like edit.html / viewer.html which
   provide their own minimal "back" affordance instead).
   ============================================================ */
(function () {
  'use strict';

  const CURRENT = (location.pathname.split('/').pop() || 'index.html').toLowerCase();

  // Single source of truth for the whole app's navigation.
  const MAIN_ITEMS = [
    { href: 'feed.html', icon: '🏠', label: 'Feed', match: ['feed.html', 'index.html', ''] },
    { href: 'convert.html', icon: '⚡', label: 'Discover', match: ['convert.html'] },
    { href: 'upload.html', icon: '✦', label: 'Create', match: ['upload.html'] },
    { href: 'profile.html', icon: '👤', label: 'Profile', match: ['profile.html'] },
    { href: 'notifications.html', icon: '🔔', label: 'Alerts', match: ['notifications.html'], badge: 'notif' }
  ];

  const STUDIO_ITEMS = [
    { href: 'upload.html', icon: '🧊', label: 'New Capture', match: [] },
    { href: 'media-edit.html', icon: '🎬', label: 'Video / Photo', match: ['media-edit.html'] },
    { href: 'edit.html', icon: '✏️', label: 'Editor', match: ['edit.html'] }
  ];

  const FOOTER_ITEMS = [
    { href: 'settings.html', icon: '⚙️', label: 'Settings', match: ['settings.html'] }
  ];

  function isActive(item) {
    return item.match.includes(CURRENT);
  }

  function linkHTML(item, extraClass) {
    const active = isActive(item) ? ' fnav-active' : '';
    const badge = item.badge
      ? `<span class="fnav-badge" data-badge="${item.badge}" hidden>0</span>`
      : '';
    return `<a href="${item.href}" class="fnav-item ${extraClass}${active}">
      <span class="fnav-icon">${item.icon}</span><span class="fnav-label">${item.label}</span>${badge}
    </a>`;
  }

  function buildMarkup() {
    const mainLinks = MAIN_ITEMS.map((i) => linkHTML(i, 'fnav-main')).join('');
    const studioLinks = STUDIO_ITEMS.map((i) => linkHTML(i, 'fnav-studio')).join('');
    const footerLinks = FOOTER_ITEMS.map((i) => linkHTML(i, 'fnav-footer')).join('');

    return `
      <!-- Mobile topbar -->
      <header class="fnav-topbar">
        <button class="fnav-burger" aria-label="Open menu" aria-expanded="false" aria-controls="fnavDrawer">
          <span></span><span></span><span></span>
        </button>
        <a href="feed.html" class="fnav-logo">FUMO<span>C</span>A</a>
        <a href="notifications.html" class="fnav-bell" aria-label="Notifications">
          🔔<span class="fnav-badge" data-badge="notif" hidden>0</span>
        </a>
      </header>

      <!-- Mobile drawer + backdrop -->
      <div class="fnav-backdrop" id="fnavBackdrop"></div>
      <nav class="fnav-drawer" id="fnavDrawer" aria-hidden="true">
        <div class="fnav-drawer-head">
          <a href="feed.html" class="fnav-logo">FUMO<span>C</span>A</a>
          <button class="fnav-close" aria-label="Close menu">✕</button>
        </div>
        <div class="fnav-drawer-user" id="fnavUser">
          <div class="fnav-avatar" id="fnavAvatar">?</div>
          <div>
            <div class="fnav-username" id="fnavUsername">Loading…</div>
            <div class="fnav-handle" id="fnavHandle">@…</div>
          </div>
        </div>
        <div class="fnav-section-label">Explore</div>
        ${mainLinks}
        <div class="fnav-section-label">Studio</div>
        ${studioLinks}
        <div class="fnav-drawer-spacer"></div>
        ${footerLinks}
        <a href="upload.html" class="fnav-create-btn">+ Create Capture</a>
      </nav>

      <!-- Desktop sidebar -->
      <aside class="fnav-sidebar">
        <a href="feed.html" class="fnav-logo">FUMO<span>C</span>A</a>
        <div class="fnav-section-label">Explore</div>
        ${mainLinks}
        <div class="fnav-section-label">Studio</div>
        ${studioLinks}
        <div class="fnav-drawer-spacer"></div>
        ${footerLinks}
        <a href="upload.html" class="fnav-create-btn">+ Create Capture</a>
      </aside>
    `;
  }

  function inject() {
    if (document.body.dataset.nav === 'none') return;

    const mount = document.createElement('div');
    mount.id = 'fumoca-nav';
    mount.innerHTML = buildMarkup();
    document.body.prepend(mount);
    document.body.classList.add('fnav-has-nav');

    const burger = mount.querySelector('.fnav-burger');
    const closeBtn = mount.querySelector('.fnav-close');
    const drawer = mount.querySelector('#fnavDrawer');
    const backdrop = mount.querySelector('#fnavBackdrop');

    function openDrawer() {
      drawer.classList.add('fnav-open');
      backdrop.classList.add('fnav-open');
      drawer.setAttribute('aria-hidden', 'false');
      burger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('fnav-scroll-lock');
    }
    function closeDrawer() {
      drawer.classList.remove('fnav-open');
      backdrop.classList.remove('fnav-open');
      drawer.setAttribute('aria-hidden', 'true');
      burger.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('fnav-scroll-lock');
    }

    burger.addEventListener('click', openDrawer);
    closeBtn.addEventListener('click', closeDrawer);
    backdrop.addEventListener('click', closeDrawer);
    drawer.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeDrawer));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDrawer();
    });

    window.FumocaNav = {
      setBadge(name, count) {
        document.querySelectorAll(`[data-badge="${name}"]`).forEach((el) => {
          if (count > 0) {
            el.hidden = false;
            el.textContent = count > 99 ? '99+' : String(count);
          } else {
            el.hidden = true;
          }
        });
      },
      setUser({ name, handle, avatarUrl, initials }) {
        const nameEl = document.getElementById('fnavUsername');
        const handleEl = document.getElementById('fnavHandle');
        const avatarEl = document.getElementById('fnavAvatar');
        if (nameEl && name) nameEl.textContent = name;
        if (handleEl && handle) handleEl.textContent = handle;
        if (avatarEl) {
          if (avatarUrl) {
            avatarEl.style.backgroundImage = `url(${avatarUrl})`;
            avatarEl.textContent = '';
          } else if (initials) {
            avatarEl.textContent = initials;
          }
        }
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
