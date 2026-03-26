const https = require('https');

function callClaude(body) {
  return new Promise(function(resolve, reject) {
    var data = JSON.stringify(body);
    var opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  var key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다. Vercel 환경변수를 확인하세요.' });

  var body = req.body || {};
  if (!body.messages || !body.messages.length) {
    return res.status(400).json({ error: 'messages 누락' });
  }

  try {
    var r = await callClaude({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: body.max_tokens || 1000,
      messages: body.messages,
    });

    if (r.status !== 200) {
      var errBody = {};
      try { errBody = JSON.parse(r.body); } catch(e) {}
      var detail = (errBody.error && errBody.error.message) || r.body.slice(0, 300);
      var isCredit = /credit|billing|balance|payment/i.test(detail);
      return res.status(500).json({
        error: 'Claude API 오류: ' + r.status,
        detail: detail,
        errorCode: isCredit ? 'credit_low' : undefined,
      });
    }

    res.json(JSON.parse(r.body));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
