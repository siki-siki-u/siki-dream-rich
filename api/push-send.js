// GitHub Actions 크론이 매 시간 호출 → 발표 1일 전 / 1시간 전 Push 알림 발송
// Node.js 내장 crypto만 사용 (외부 패키지 의존 없음)
const crypto = require('crypto');
const https  = require('https');

const SUPA_URL = 'https://boyhppqnwtxedicxbfpz.supabase.co';
const SUPA_KEY = 'sb_publishable_Uh-YK_wDgAgQMO_CZwnyRw_SrRyQ-Tq';
const VAPID_EMAIL = 'mailto:yoonsik092609@gmail.com';

const COUNTRY_FLAG = { USD:'🇺🇸', KRW:'🇰🇷', JPY:'🇯🇵', EUR:'🇪🇺', GBP:'🇬🇧', CNY:'🇨🇳' };
const COUNTRY_KO   = { USD:'미국', KRW:'한국', JPY:'일본', EUR:'유로존', GBP:'영국', CNY:'중국' };
const EVENT_KO = {
  'Fed Interest Rate Decision':'연준 기준금리 결정','Federal Funds Rate':'연준 기준금리',
  'FOMC Statement':'FOMC 성명서','FOMC Press Conference':'FOMC 기자회견',
  'CPI m/m':'소비자물가지수(월)','CPI y/y':'소비자물가지수(연)',
  'Core CPI m/m':'근원 CPI(월)','Non-Farm Employment Change':'비농업 고용자수',
  'Non-Farm Payrolls':'비농업 고용자수','Unemployment Rate':'실업률',
  'PPI m/m':'생산자물가지수(월)','Core PCE Price Index m/m':'근원 PCE(월)',
  'GDP q/q':'GDP(분기)','BOJ Interest Rate Decision':'일본 기준금리 결정',
  'BOK Rate Decision':'한국 기준금리 결정','ECB Interest Rate Decision':'ECB 기준금리 결정',
  'Japanese CPI y/y':'일본 소비자물가지수','Korean CPI y/y':'한국 소비자물가지수',
};

// ── 유틸 ──
function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g,'+').replace(/_/g,'/'), 'base64');
}
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function hkdfExtract(salt, ikm) {
  return crypto.createHmac('sha256', salt).update(ikm).digest();
}
function hkdfExpand(prk, info, len) {
  const out = []; let prev = Buffer.alloc(0);
  for (let i = 1; out.reduce((a,b) => a+b.length, 0) < len; i++) {
    prev = crypto.createHmac('sha256', prk).update(Buffer.concat([prev, info, Buffer.from([i])])).digest();
    out.push(prev);
  }
  return Buffer.concat(out).slice(0, len);
}

// DER ECDSA 서명 → raw r||s (JWT ES256 포맷)
function derToRawSig(der) {
  let off = 2;
  off++; // skip 0x02
  const rLen = der[off++];
  const r = der.slice(off, off + rLen); off += rLen;
  off++; // skip 0x02
  const sLen = der[off++];
  const s = der.slice(off, off + sLen);
  const pad = (b) => { b = b.slice(-32); return Buffer.concat([Buffer.alloc(32 - b.length), b]); };
  return Buffer.concat([pad(r), pad(s)]);
}

// VAPID JWT 생성 (ES256)
function makeVapidJwt(vapidPubB64, vapidPrivB64, audience) {
  const pubBytes = b64urlDecode(vapidPubB64);
  const privKey = crypto.createPrivateKey({
    key: {
      kty: 'EC', crv: 'P-256',
      d: vapidPrivB64,
      x: b64urlEncode(pubBytes.slice(1, 33)),
      y: b64urlEncode(pubBytes.slice(33, 65)),
    },
    format: 'jwk',
  });
  const header  = b64urlEncode(Buffer.from(JSON.stringify({ typ:'JWT', alg:'ES256' })));
  const payload = b64urlEncode(Buffer.from(JSON.stringify({ aud: audience, exp: Math.floor(Date.now()/1000) + 43200, sub: VAPID_EMAIL })));
  const input   = header + '.' + payload;
  const sign    = crypto.createSign('SHA256');
  sign.update(input);
  const rawSig  = derToRawSig(sign.sign(privKey));
  return input + '.' + b64urlEncode(rawSig);
}

// RFC 8291 aes128gcm 페이로드 암호화
function encryptWebPush(plaintext, p256dhB64, authB64) {
  const subPub    = b64urlDecode(p256dhB64); // 65 bytes uncompressed
  const authSec   = b64urlDecode(authB64);   // 16 bytes
  const salt      = crypto.randomBytes(16);

  // 에피메럴 키 생성
  const { privateKey: ephPriv, publicKey: ephPub } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const ephPubBytes = ephPub.export({ type:'spki', format:'der' }).slice(27); // 65 bytes

  // 수신자 공개키 로드
  const receiverKey = crypto.createPublicKey({
    key: { kty:'EC', crv:'P-256', x: b64urlEncode(subPub.slice(1,33)), y: b64urlEncode(subPub.slice(33,65)) },
    format: 'jwk',
  });

  // ECDH 공유 비밀
  const sharedSecret = crypto.diffieHellman({ privateKey: ephPriv, publicKey: receiverKey });

  // IKM 유도 (RFC 8291 §3.3)
  const prkKey = hkdfExtract(authSec, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\x00'), subPub, ephPubBytes]);
  const ikm     = hkdfExpand(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]), 32);

  // CEK + Nonce 유도
  const prk   = hkdfExtract(salt, ikm);
  const cek   = hkdfExpand(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\x00'), Buffer.from([1])]), 16);
  const nonce = hkdfExpand(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\x00'),    Buffer.from([1])]), 12);

  // 패딩 + AES-128-GCM 암호화
  const padded = Buffer.concat([Buffer.from(plaintext, 'utf8'), Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body   = Buffer.concat([
    cipher.update(padded), cipher.final(), cipher.getAuthTag(),
  ]);

  // 레코드 헤더: salt(16) + rs(4) + idlen(1) + eph_pub(65)
  const rsBuffer = Buffer.alloc(4); rsBuffer.writeUInt32BE(4096, 0);
  const record   = Buffer.concat([salt, rsBuffer, Buffer.from([ephPubBytes.length]), ephPubBytes, body]);

  return { record, ephPubB64: b64urlEncode(ephPubBytes), saltB64: b64urlEncode(salt) };
}

// Push 엔드포인트에 HTTP POST
function sendPush(endpoint, p256dh, auth, vapidPub, vapidPriv, payload) {
  return new Promise(function(resolve, reject) {
    const audience = new URL(endpoint).origin;
    const jwt      = makeVapidJwt(vapidPub, vapidPriv, audience);
    const { record } = encryptWebPush(JSON.stringify(payload), p256dh, auth);
    const u = new URL(endpoint);
    const req = https.request({
      hostname: u.hostname,
      path:     u.pathname + u.search,
      method:  'POST',
      headers: {
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Content-Length':    record.length,
        'TTL':              '86400',
        'Urgency':          'normal',
        'Authorization':    'vapid t=' + jwt + ',k=' + vapidPub,
      },
    }, function(res) {
      let d = '';
      res.on('data', function(c) { d += c; });
      res.on('end',  function()  { resolve({ status: res.statusCode, body: d }); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('timeout')); });
    req.write(record);
    req.end();
  });
}

// ── Supabase 헬퍼 ──
function supaRest(method, path, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: new URL(SUPA_URL).hostname,
      path, method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end',  function()  { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
async function getSetting(key) {
  var r = await supaRest('GET', '/rest/v1/settings?key=eq.' + encodeURIComponent(key) + '&select=value', null);
  try { var rows = JSON.parse(r.body); return rows && rows[0] ? rows[0].value : null; } catch(_) { return null; }
}
async function deleteSub(endpoint) {
  try { await supaRest('DELETE', '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), null); } catch(_) {}
}

function translateEvent(title) {
  if (!title) return title;
  var d = EVENT_KO[title.trim()]; if (d) return d;
  for (var k in EVENT_KO) { if (title.toLowerCase().includes(k.toLowerCase())) return EVENT_KO[k]; }
  return title;
}

// ── 메인 핸들러 ──
module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var secret = process.env.CRON_SECRET;
  if (secret && req.headers['x-cron-secret'] !== secret) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // ① VAPID 키
    var vapidPub  = await getSetting('vapid_public_key');
    var vapidPriv = await getSetting('vapid_private_key');
    if (!vapidPub || !vapidPriv) return res.status(500).json({ error: 'VAPID 키 없음 — /api/push-setup 먼저 호출' });

    // ② ForexFactory 이벤트
    var ALLOWED = ['USD','KRW','JPY'], ALLOWED_IMPACT = ['High','Medium'];
    var allEvents = [];
    for (var w of ['thisweek','nextweek']) {
      try {
        var r = await new Promise(function(resolve, reject) {
          var req2 = https.request({ hostname:'nfs.faireconomy.media', path:'/ff_calendar_'+w+'.json?timezone=Asia/Seoul', method:'GET', headers:{'User-Agent':'Mozilla/5.0'}, timeout:12000 }, function(res2) {
            var c=[]; res2.on('data',function(x){c.push(x);}); res2.on('end',function(){resolve({status:res2.statusCode,body:Buffer.concat(c).toString('utf8')});});
          });
          req2.on('error',reject); req2.on('timeout',function(){req2.destroy();reject(new Error('timeout'));}); req2.end();
        });
        if (r.status === 200) JSON.parse(r.body).forEach(function(e) {
          if (ALLOWED.includes(e.currency) && ALLOWED_IMPACT.includes(e.impact) && e.date) allEvents.push(e);
        });
      } catch(_) {}
    }
    if (!allEvents.length) return res.json({ sent:0, message:'이벤트 없음' });

    // ③ 알림 대상 필터
    var nowMs = Date.now(), toNotify = [];
    allEvents.forEach(function(ev) {
      var diffM = (new Date(ev.date).getTime() - nowMs) / 60000;
      if (diffM >= 50  && diffM < 70)   toNotify.push({ ev, type:'1hour' });
      else if (diffM >= 1430 && diffM < 1450) toNotify.push({ ev, type:'1day' });
    });
    if (!toNotify.length) return res.json({ sent:0, message:'알림 대상 없음' });

    // ④ 구독자
    var subRes = await supaRest('GET', '/rest/v1/push_subscriptions?select=*', null);
    var subs = []; try { subs = JSON.parse(subRes.body) || []; } catch(_) {}
    if (!subs.length) return res.json({ sent:0, message:'구독자 없음' });

    // ⑤ 발송
    var sent = 0, errors = 0;
    for (var { ev, type } of toNotify) {
      var flag = COUNTRY_FLAG[ev.currency]||'', country = COUNTRY_KO[ev.currency]||ev.currency;
      var pushTitle = type==='1hour' ? ('⏰ 1시간 후 발표 '+flag) : ('📅 내일 발표 예정 '+flag);
      var pushBody  = country+' · '+translateEvent(ev.title)+'\n⏱ '+( ev.time||'시간 미정' )+' (KST)'+(ev.forecast?'\n📊 예측: '+ev.forecast:'')+(ev.previous?' · 이전: '+ev.previous:'');
      var payload   = { title:pushTitle, body:pushBody, tag:'econ-'+ev.currency+'-'+(ev.date||'').replace(/\D/g,'').slice(0,10)+'-'+type, url:'/?page=market' };

      for (var sub of subs) {
        try {
          var result = await sendPush(sub.endpoint, sub.p256dh, sub.auth, vapidPub, vapidPriv, payload);
          if (result.status >= 200 && result.status < 300) { sent++; }
          else if (result.status === 404 || result.status === 410) { errors++; await deleteSub(sub.endpoint); }
          else { errors++; }
        } catch(e) { errors++; }
      }
    }

    res.json({ sent, errors, events: toNotify.length, subs: subs.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
