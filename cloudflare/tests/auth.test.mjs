// Extract just the authorize() function logic to test in isolation
// (re-implementing the exact same logic here since Workers modules use
// `export default { fetch }` which needs a Workers runtime to import directly —
// this tests the same auth decision logic against mocked fetch responses)

async function authorize(request, env, fetchImpl) {
  const serverSecret = request.headers.get('X-Fumoca-Secret');
  if (serverSecret && env.FUMOCA_API_SECRET && serverSecret === env.FUMOCA_API_SECRET) {
    return { id: 'server', kind: 'server-to-server' };
  }
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  try {
    const resp = await fetchImpl(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_ANON_KEY },
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    return user?.id ? { id: user.id, kind: 'user' } : null;
  } catch (e) {
    return null;
  }
}

let pass=0, fail=0;
function check(name, cond, detail='') { if(cond){pass++;console.log('PASS:',name);} else {fail++;console.log('FAIL:',name,detail);} }

const env = { FUMOCA_API_SECRET: 'real-server-secret', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

// 1. Valid server secret -> authorized as server
{
  const req = new Request('https://x', { headers: { 'X-Fumoca-Secret': 'real-server-secret' } });
  const p = await authorize(req, env, async () => { throw new Error('should not call fetch'); });
  check('valid server secret authorizes without needing a Supabase call', p?.kind === 'server-to-server', JSON.stringify(p));
}

// 2. Wrong/old leaked secret -> rejected (simulating post-rotation)
{
  const req = new Request('https://x', { headers: { 'X-Fumoca-Secret': 'fumoca-r2-2026-xK9mP3qL' } });
  const p = await authorize(req, {...env}, async () => ({ ok: false }));
  check('the OLD leaked secret is rejected once rotated (no longer matches env)', p === null, JSON.stringify(p));
}

// 3. No header at all -> rejected
{
  const req = new Request('https://x');
  const p = await authorize(req, env, async () => ({ ok: false }));
  check('no auth headers at all -> rejected', p === null);
}

// 4. Valid-looking bearer token, Supabase confirms it's a real user -> authorized
{
  const req = new Request('https://x', { headers: { Authorization: 'Bearer real-user-token' } });
  const fakeFetch = async (url, opts) => {
    if (url.includes('/auth/v1/user') && opts.headers.Authorization === 'Bearer real-user-token') {
      return { ok: true, json: async () => ({ id: 'user-123' }) };
    }
    return { ok: false };
  };
  const p = await authorize(req, env, fakeFetch);
  check('valid Supabase session token authorizes as that user', p?.kind === 'user' && p?.id === 'user-123', JSON.stringify(p));
}

// 5. Expired/invalid bearer token -> Supabase says no -> rejected
{
  const req = new Request('https://x', { headers: { Authorization: 'Bearer expired-token' } });
  const fakeFetch = async () => ({ ok: false });
  const p = await authorize(req, env, fakeFetch);
  check('expired/invalid session token is rejected', p === null);
}

// 6. Someone tries to forge a random bearer token -> rejected (Supabase call fails)
{
  const req = new Request('https://x', { headers: { Authorization: 'Bearer totally-made-up-token' } });
  const fakeFetch = async () => ({ ok: false });
  const p = await authorize(req, env, fakeFetch);
  check('a forged/random bearer token is rejected', p === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
