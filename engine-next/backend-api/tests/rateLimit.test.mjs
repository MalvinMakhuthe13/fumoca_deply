import { rateLimit } from '../middleware/rateLimit.js';

let pass=0, fail=0;
function check(name, cond, detail='') { if(cond){pass++;console.log('PASS:',name);} else {fail++;console.log('FAIL:',name,detail);} }

function mockReqRes(ip='1.2.3.4') {
  const headers = {};
  const req = { ip };
  const res = {
    statusCode: 200,
    body: null,
    setHeader: (k,v) => { headers[k]=v; },
    status: function(c){ this.statusCode=c; return this; },
    json: function(b){ this.body=b; return this; },
    headers,
  };
  return { req, res };
}

const limiter = rateLimit({ max: 3, windowMs: 1000, keyFn: r => r.ip, message: 'slow down' });

// First 3 requests from same IP should pass
let nextCalls = 0;
const next = () => { nextCalls++; };
for (let i = 0; i < 3; i++) {
  const { req, res } = mockReqRes('1.1.1.1');
  limiter(req, res, next);
}
check('first 3 requests within limit all call next()', nextCalls === 3, nextCalls);

// 4th request should be blocked with 429
{
  const { req, res } = mockReqRes('1.1.1.1');
  limiter(req, res, next);
  check('4th request over the limit gets HTTP 429', res.statusCode === 429, res.statusCode);
  check('429 response includes Retry-After header', res.headers['Retry-After'] !== undefined);
  check('429 response includes the custom message', res.body?.error === 'slow down', JSON.stringify(res.body));
}

// A DIFFERENT ip should NOT be blocked (per-key isolation)
{
  const { req, res } = mockReqRes('2.2.2.2');
  const beforeNext = nextCalls;
  limiter(req, res, next);
  check('a different IP is tracked independently (not globally blocked)', nextCalls === beforeNext + 1 && res.statusCode === 200);
}

// Headers on a successful request reflect remaining count correctly -
// specifically checking the FIRST request in a fresh window, which is exactly
// where the original bug was: an early-return path skipped header-setting entirely.
{
  const limiter2 = rateLimit({ max: 5, windowMs: 1000, keyFn: r => r.ip });
  const { req, res } = mockReqRes('3.3.3.3');
  limiter2(req, res, () => {});
  check('FIRST request in a fresh window still gets X-RateLimit-Limit header', res.headers['X-RateLimit-Limit'] === 5, JSON.stringify(res.headers));
  check('FIRST request in a fresh window correctly shows 4 remaining', res.headers['X-RateLimit-Remaining'] === 4, res.headers['X-RateLimit-Remaining']);
  check('FIRST request in a fresh window has a Reset header too', typeof res.headers['X-RateLimit-Reset'] === 'number');
}

// Window reset: after windowMs elapses, count should reset
{
  const shortLimiter = rateLimit({ max: 1, windowMs: 50, keyFn: r => r.ip });
  const { req, res } = mockReqRes('4.4.4.4');
  shortLimiter(req, res, () => {});
  const { req: req2, res: res2 } = mockReqRes('4.4.4.4');
  shortLimiter(req2, res2, () => {});
  check('2nd request within window is blocked', res2.statusCode === 429);

  await new Promise(r => setTimeout(r, 60));
  const { req: req3, res: res3 } = mockReqRes('4.4.4.4');
  let allowed = false;
  shortLimiter(req3, res3, () => { allowed = true; });
  check('request after window expires is allowed again', allowed === true, res3.statusCode);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail>0?1:0);
