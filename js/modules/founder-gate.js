/**
 * Founder-only gate for Studio and admin.
 *
 * PR preview deployments on the FUMOCA Pages project are intentionally open
 * for anonymous feature testing. This is a client-side preview convenience,
 * not an authorization boundary for private data or cloud publishing.
 *
 * Production and all non-preview hosts continue to require a signed-in user
 * whose email is in FUMOCA_FOUNDER_EMAILS.
 */
const FumocaFounderGate = (() => {
  function isPreviewTestingHost() {
    const hostname = window.location?.hostname?.toLowerCase() || '';
    // Keep local development and PR preview deployments open during testing.
    // Re-enable founder restrictions only after the manual workflow is accepted.
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '[::1]'
      || hostname.endsWith('.fumoca-deply.pages.dev');
  }

  function allowlist() {
    const fromWindow = window.FUMOCA_FOUNDER_EMAILS;
    if (Array.isArray(fromWindow) && fromWindow.length) {
      return fromWindow.map(e => String(e).toLowerCase());
    }
    return [];
  }

  async function currentUser() {
    const sb = window._fumocaSupabase || window.supabase;
    if (!sb?.auth?.getUser) return null;
    const { data } = await sb.auth.getUser();
    return data?.user || null;
  }

  async function isFounder() {
    // Preview-only bypass must happen before Supabase user lookup so anonymous
    // testers can use Studio. This does not change worker-side publish checks.
    if (isPreviewTestingHost()) {
      return { ok: true, reason: 'preview_testing', email: null };
    }

    const user = await currentUser();
    if (!user) return { ok: false, reason: 'unauthenticated' };
    const email = (user.email || '').toLowerCase();

    const list = allowlist();
    if (!list.length) return { ok: false, reason: 'allowlist_empty' };
    const ok = list.includes(email);
    return { ok, reason: ok ? 'founder' : 'not_founder', email };
  }

  async function requireFounder(redirectTo = 'login.html') {
    const result = await isFounder();
    if (!result.ok && typeof document !== 'undefined') {
      const wall = document.createElement('div');
      wall.id = 'founderWall';
      wall.style.cssText = 'position:fixed;inset:0;background:#0b0d12;color:#f4f6f8;z-index:9999;display:flex;align-items:center;justify-content:center;font:16px system-ui;text-align:center;padding:24px;';
      wall.innerHTML = `<div><h1>Founder access only</h1><p>${result.reason === 'unauthenticated' ? 'Sign in with the founder account.' : 'This account cannot open Studio.'}</p><p><a href="${redirectTo}" style="color:#c8ff00;">Sign in</a></p></div>`;
      document.body.appendChild(wall);
    }
    return result;
  }

  return { isFounder, requireFounder, allowlist };
})();

window.FumocaFounderGate = FumocaFounderGate;
export default FumocaFounderGate;
