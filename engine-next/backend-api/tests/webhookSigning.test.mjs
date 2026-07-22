process.env.SUPABASE_PUBLISHABLE_KEY = 'test-fake-pub-key';
process.env.SUPABASE_SECRET_KEY = 'test-fake-secret-key';

const { buildSignedDelivery } = await import('../middleware/webhooks.js');
import crypto from 'crypto';

let pass=0, fail=0;
function check(name, cond, detail='') { if(cond){pass++;console.log('PASS:',name);} else {fail++;console.log('FAIL:',name,detail);} }

const secret = 'whsec_test123';
const { body, signature } = buildSignedDelivery(secret, 'nif.reconstruction.complete', { fileId: 'abc-123' }, 0);

// Independently recompute the expected HMAC the way a THIRD PARTY receiving this
// webhook would, to prove the signature is actually verifiable by an external consumer
const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
check('signature matches independent HMAC-SHA256 recomputation', signature === expected);

// A receiver verifying with the WRONG secret should NOT get a match (this is what
// protects against a spoofed webhook claiming to be from FUMOCA)
const wrongSig = crypto.createHmac('sha256', 'wrong-secret').update(body).digest('hex');
check('wrong secret produces a different signature (spoofing protection works)', wrongSig !== signature);

// Body must actually contain the real event/payload (not signing something else)
const parsed = JSON.parse(body);
check('signed body contains the real event name', parsed.event === 'nif.reconstruction.complete');
check('signed body contains the real payload', parsed.payload.fileId === 'abc-123');
check('signed body includes attempt number (for retry tracking)', parsed.attempt === 0);

// Different payloads must produce different signatures (no signature reuse/replay across events)
const { signature: sig2 } = buildSignedDelivery(secret, 'nif.reconstruction.failed', { fileId: 'abc-123' }, 0);
check('different event produces a different signature (no cross-event replay)', sig2 !== signature);

// Missing secret should not crash - degrades safely (though such a webhook shouldn't be trusted)
let noCrash = true;
try { buildSignedDelivery(undefined, 'test', {}, 0); } catch { noCrash = false; }
check('missing secret does not throw (safe default via ?? "")', noCrash);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
