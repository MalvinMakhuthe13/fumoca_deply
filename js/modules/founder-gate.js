/**
 * Founder-only gate for Studio and admin.
 * An obscure URL is not access control. This checks the signed-in user.
 * Configure window.FUMOCA_FOUNDER_EMAILS before load, or set it in config.js.
 */
const FumocaFounderGate = (() => {
  function allowlist() {
    const fromWindow = window.FUMOCA_FOUNDER_EMAILS;
    if (Array.isArray(fromWindow) && fromWindow.length) return fromWindow.map(e => String(e).toLowerCase());
    return [];
  }

  async function currentUser() {
    const sb = window._fumocaSupabase || window.supabase;
    if (!sb?.auth?.getUser) return null;
    const { data } = await sb.auth.getUser();
    return data?.user || null;
  }

  async function isFounder() {
    const user = await currentUser();
    if (!user) return { ok: false, reason: 'unauthenticated' };
    const email = (user.email || '').toLowerCase();

    // Temporary access for authenticated users on the PR #33 branch preview.
    // Keep the production founder allowlist enforced on every other hostname.
    const previewTestingHost = 'cursor-anim-client-demo-c441.fumoca-deply.pages.dev';
    if (window.location?.hostname === previewTestingHost) {
      return { ok: true, reason: 'preview_testing', email };
    }

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
