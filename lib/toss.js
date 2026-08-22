const https = require('https');

let _token = null;
let _tokenExpiresAt = 0;

function req(method, urlStr, opts) {
  opts = opts || {};
  return new Promise(function(resolve, reject) {
    var u = new URL(urlStr);
    var headers = opts.headers || {};
    var bodyStr = opts.body || null;
    if (bodyStr) headers['Content-Length'] = Buffer.byteLength(bodyStr);
    var r = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: method,
      headers: headers,
      timeout: 12000,
    }, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        var text = Buffer.concat(chunks).toString('utf8');
        var json = null;
        try { json = JSON.parse(text); } catch (e) {}
        resolve({ status: res.statusCode, json: json, text: text });
      });
    });
    r.on('error', reject);
    r.on('timeout', function() { r.destroy(); reject(new Error('timeout')); });
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

async function getToken() {
  if (_token && Date.now() < _tokenExpiresAt - 60000) return _token;
  var clientId = process.env.TOSS_CLIENT_ID;
  var clientSecret = process.env.TOSS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 환경변수가 없어요');

  var body = 'grant_type=client_credentials&client_id=' + encodeURIComponent(clientId) +
    '&client_secret=' + encodeURIComponent(clientSecret);

  var r = await req('POST', 'https://openapi.tossinvest.com/oauth2/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body,
  });

  if (r.status !== 200 || !r.json || !r.json.access_token) {
    var err = new Error('토스 토큰 발급 실패 (HTTP ' + r.status + '): ' + (r.json && r.json.error_description || r.text.slice(0, 300)));
    err.status = r.status;
    err.body = r.json || r.text;
    throw err;
  }

  _token = r.json.access_token;
  _tokenExpiresAt = Date.now() + (r.json.expires_in || 86400) * 1000;
  return _token;
}

async function tossGet(path, opts) {
  opts = opts || {};
  var token = await getToken();
  var headers = Object.assign({ 'Authorization': 'Bearer ' + token }, opts.headers || {});
  return req('GET', 'https://openapi.tossinvest.com' + path, { headers: headers });
}

module.exports = { getToken, tossGet };
