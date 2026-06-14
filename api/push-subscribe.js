// Push 구독 등록 (POST) / 해제 (DELETE)
const https = require('https');

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

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var body = req.body || {};

  try {
    if (req.method === 'POST') {
      var { endpoint, p256dh, auth } = body;
      if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: 'endpoint, p256dh, auth 필요' });

      var r = await supaRest('POST', '/rest/v1/push_subscriptions', { endpoint, p256dh, auth });
      return res.json({ ok: r.status < 300 });

    } else if (req.method === 'DELETE') {
      var { endpoint } = body;
      if (!endpoint) return res.status(400).json({ error: 'endpoint 필요' });

      await supaRest('DELETE', '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), null);
      return res.json({ ok: true });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
