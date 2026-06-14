// VAPID 키 최초 생성 후 Supabase settings에 저장, 이후엔 기존 키 반환
// Node.js 내장 crypto 사용 (외부 패키지 의존 없음)
const crypto = require('crypto');
const https  = require('https');

const SUPA_URL = 'https://boyhppqnwtxedicxbfpz.supabase.co';
const SUPA_KEY = 'sb_publishable_Uh-YK_wDgAgQMO_CZwnyRw_SrRyQ-Tq';

function supaRest(method, path, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: new URL(SUPA_URL).hostname,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
        'Prefer': 'resolution=merge-duplicates',
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
  if (r.status !== 200) return null;
  try { var rows = JSON.parse(r.body); return rows && rows[0] ? rows[0].value : null; } catch(_) { return null; }
}

async function setSetting(key, value) {
  await supaRest('POST', '/rest/v1/settings', { key, value });
}

// ECDH prime256v1 키쌍 생성 → VAPID 호환 URL-safe Base64 변환
function generateVapidKeys() {
  var { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

  // Public key: SPKI DER에서 65바이트 비압축 포인트 추출 (offset 27)
  var pubDer  = publicKey.export({ type: 'spki', format: 'der' });
  var pubBytes = pubDer.slice(27); // 04 || x || y (65 bytes)

  // Private key: PKCS8 DER에서 32바이트 raw 추출
  var privDer   = privateKey.export({ type: 'pkcs8', format: 'der' });
  // prime256v1 PKCS8에서 private key는 offset 36 ~ 36+32
  var privBytes = privDer.slice(36, 68);

  var toB64 = function(buf) {
    return Buffer.from(buf).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  };

  return { publicKey: toB64(pubBytes), privateKey: toB64(privBytes) };
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    var pub = await getSetting('vapid_public_key');

    if (!pub) {
      var keys = generateVapidKeys();
      await setSetting('vapid_public_key',  keys.publicKey);
      await setSetting('vapid_private_key', keys.privateKey);
      pub = keys.publicKey;
    }

    res.json({ publicKey: pub });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
