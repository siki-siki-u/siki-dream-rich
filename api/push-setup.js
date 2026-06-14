// VAPID 키 최초 생성 후 Supabase settings에 저장, 이후엔 기존 키 반환
const webpush = require('web-push');
const https   = require('https');

const SUPA_URL = 'https://boyhppqnwtxedicxbfpz.supabase.co';
const SUPA_KEY = 'sb_publishable_Uh-YK_wDgAgQMO_CZwnyRw_SrRyQ-Tq';

function supaRest(method, path, body) {
  return new Promise(function(resolve, reject) {
    var u    = new URL(SUPA_URL);
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: u.hostname,
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

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    var pub = await getSetting('vapid_public_key');

    if (!pub) {
      // 최초 1회: VAPID 키 쌍 생성 후 Supabase에 저장
      var keys = webpush.generateVAPIDKeys();
      await setSetting('vapid_public_key',  keys.publicKey);
      await setSetting('vapid_private_key', keys.privateKey);
      pub = keys.publicKey;
    }

    res.json({ publicKey: pub });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
