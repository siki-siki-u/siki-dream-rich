// 지문 / Face ID 로그인 (WebAuthn)
// Vercel Hobby 플랜 함수 12개 제한 때문에 별도 함수 대신 api/economic-calendar.js 에서
// action=webauthn-* 로 호출됨.
// 서버가 챌린지를 발급하고 서명을 검증한 뒤 Supabase 일회용 로그인 토큰을 내려줌.
// 비밀번호는 어디에도 저장하지 않고, 기기의 공개키만 webauthn_credentials 테이블에 저장함.
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

var SUPABASE_URL = process.env.SUPABASE_URL || 'https://boyhppqnwtxedicxbfpz.supabase.co';
var SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
var RP_NAME = '식식징구월드';
var CHALLENGE_TTL_MS = 5 * 60 * 1000;

function httpError(status, message) {
  var e = new Error(message);
  e.status = status;
  return e;
}

async function supaFetch(path, opts) {
  opts = opts || {};
  var headers = Object.assign({
    apikey: SERVICE_KEY,
    Authorization: 'Bearer ' + SERVICE_KEY,
    'Content-Type': 'application/json',
  }, opts.headers || {});
  var r = await fetch(SUPABASE_URL + path, Object.assign({}, opts, { headers: headers }));
  var text = await r.text();
  var json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) throw httpError(r.status >= 500 ? 502 : 400, (json && (json.msg || json.message || json.error_description)) || text || 'Supabase 요청 실패');
  return json;
}

function rest(table, query, opts) {
  return supaFetch('/rest/v1/' + table + (query ? '?' + query : ''), opts);
}

// 요청 Host 기준으로 rpID / origin 결정 (서명 안의 rpIdHash·origin과 대조되므로 위조 불가)
function rpFor(req) {
  var host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  var rpID = host.split(':')[0];
  var proto = rpID === 'localhost' ? 'http' : 'https';
  return { rpID: rpID, origin: proto + '://' + host };
}

async function getUserFromToken(req) {
  var auth = req.headers.authorization || '';
  var token = auth.replace(/^Bearer\s+/i, '');
  if (!token) throw httpError(401, '로그인이 필요해요');
  var r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token },
  });
  if (!r.ok) throw httpError(401, '세션이 만료됐어요. 다시 로그인해 주세요');
  return r.json();
}

async function saveChallenge(challenge, kind, userId) {
  var rows = await rest('webauthn_challenges', '', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      challenge: challenge, kind: kind, user_id: userId || null,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    }),
  });
  // 만료된 챌린지 정리 (실패해도 무시)
  rest('webauthn_challenges', 'expires_at=lt.' + encodeURIComponent(new Date().toISOString()), { method: 'DELETE' }).catch(function() {});
  return rows[0].id;
}

// 챌린지는 한 번만 쓸 수 있도록 꺼내면서 삭제
async function takeChallenge(id, kind) {
  if (!id) throw httpError(400, 'challengeId 필요');
  var rows = await rest('webauthn_challenges', 'id=eq.' + encodeURIComponent(id) + '&kind=eq.' + kind, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
  var row = rows && rows[0];
  if (!row) throw httpError(400, '인증 요청이 없거나 이미 사용됐어요. 다시 시도해 주세요');
  if (new Date(row.expires_at).getTime() < Date.now()) throw httpError(400, '인증 시간이 지났어요. 다시 시도해 주세요');
  return row;
}

async function handleRegisterOptions(req, res) {
  var user = await getUserFromToken(req);
  var rp = rpFor(req);
  var existing = await rest('webauthn_credentials', 'select=credential_id,transports&user_id=eq.' + user.id);
  var name = (user.user_metadata && user.user_metadata.display_name) || user.email.split('@')[0];
  var options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: name,
    userID: new TextEncoder().encode(user.id),
    attestationType: 'none',
    excludeCredentials: existing.map(function(c) { return { id: c.credential_id, transports: c.transports }; }),
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
  });
  var challengeId = await saveChallenge(options.challenge, 'register', user.id);
  res.json({ challengeId: challengeId, options: options });
}

async function handleRegisterVerify(req, res) {
  var user = await getUserFromToken(req);
  var body = req.body || {};
  var ch = await takeChallenge(body.challengeId, 'register');
  if (ch.user_id !== user.id) throw httpError(403, '다른 계정의 인증 요청이에요');
  var rp = rpFor(req);
  var result = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });
  if (!result.verified) throw httpError(400, '지문 등록 검증 실패');
  var cred = result.registrationInfo.credential;
  await rest('webauthn_credentials', '', {
    method: 'POST',
    body: JSON.stringify({
      user_id: user.id,
      credential_id: cred.id,
      public_key: Buffer.from(cred.publicKey).toString('base64'),
      counter: cred.counter,
      transports: cred.transports || [],
      device_name: String(body.deviceName || '').slice(0, 100) || null,
    }),
  });
  res.json({ ok: true });
}

async function handleLoginOptions(req, res) {
  var rp = rpFor(req);
  // allowCredentials 없이 → 기기에 저장된 패스키(discoverable credential)를 브라우저가 찾아줌
  var options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required' });
  var challengeId = await saveChallenge(options.challenge, 'login', null);
  res.json({ challengeId: challengeId, options: options });
}

async function handleLoginVerify(req, res) {
  var body = req.body || {};
  var response = body.response;
  if (!response || !response.id) throw httpError(400, 'response 필요');
  var ch = await takeChallenge(body.challengeId, 'login');
  var rows = await rest('webauthn_credentials', 'select=*&credential_id=eq.' + encodeURIComponent(response.id));
  var stored = rows && rows[0];
  if (!stored) throw httpError(404, '이 기기에 등록된 지문이 없어요. 비밀번호로 로그인한 뒤 다시 등록해 주세요');
  var rp = rpFor(req);
  var result = await verifyAuthenticationResponse({
    response: response,
    expectedChallenge: ch.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: stored.credential_id,
      publicKey: new Uint8Array(Buffer.from(stored.public_key, 'base64')),
      counter: Number(stored.counter) || 0,
      transports: stored.transports || [],
    },
  });
  if (!result.verified) throw httpError(401, '지문 인증 검증 실패');
  await rest('webauthn_credentials', 'id=eq.' + stored.id, {
    method: 'PATCH',
    body: JSON.stringify({ counter: result.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }),
  });
  // 검증 통과 → 해당 유저의 일회용 로그인 토큰 발급 (이메일은 발송되지 않음)
  var user = await supaFetch('/auth/v1/admin/users/' + stored.user_id);
  var link = await supaFetch('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email: user.email }),
  });
  if (!link || !link.hashed_token) throw httpError(502, '로그인 토큰 발급 실패');
  res.json({ tokenHash: link.hashed_token, type: link.verification_type || 'magiclink' });
}

module.exports = async function handleWebAuthn(req, res, action) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 지원해요' });
  if (!SERVICE_KEY) return res.status(500).json({ error: '서버에 SUPABASE_SERVICE_ROLE_KEY 환경변수가 없어요' });

  try {
    if (action === 'register-options') return await handleRegisterOptions(req, res);
    if (action === 'register-verify')  return await handleRegisterVerify(req, res);
    if (action === 'login-options')    return await handleLoginOptions(req, res);
    if (action === 'login-verify')     return await handleLoginVerify(req, res);
    res.status(400).json({ error: 'action 파라미터 필요 (webauthn-register-options | webauthn-register-verify | webauthn-login-options | webauthn-login-verify)' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
};
