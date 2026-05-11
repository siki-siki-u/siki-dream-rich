const https = require('https');

function httpGet(rawUrl, headers) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(rawUrl);
    var opts = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      }, headers || {}),
    };
    var req = https.request(opts, function(res) {
      // Follow single redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return httpGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function extractCookies(setCookieHeader) {
  if (!setCookieHeader) return '';
  var arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return arr.map(function(c) { return c.split(';')[0]; }).join('; ');
}

async function getCrumb() {
  // Step 1: get cookie from Yahoo Finance
  var r1 = await httpGet('https://fc.yahoo.com');
  var cookie = extractCookies(r1.headers['set-cookie']);
  if (!cookie) {
    // fallback: try finance.yahoo.com
    r1 = await httpGet('https://finance.yahoo.com/', { 'Accept': 'text/html' });
    cookie = extractCookies(r1.headers['set-cookie']);
  }
  // Step 2: get crumb
  var r2 = await httpGet('https://query2.finance.yahoo.com/v1/test/getcrumb', { 'Cookie': cookie });
  var crumb = r2.body.trim();
  if (!crumb || crumb.length < 3) throw new Error('crumb 취득 실패');
  return { crumb, cookie };
}

function round2(v) {
  return (v != null && !isNaN(v)) ? Number(v).toFixed(2) : null;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker) return res.status(400).json({ error: 'ticker 누락' });

  try {
    var { crumb, cookie } = await getCrumb();

    var url = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' +
      encodeURIComponent(ticker) +
      '?modules=summaryDetail,defaultKeyStatistics&crumb=' + encodeURIComponent(crumb);

    var r = await httpGet(url, {
      'Cookie': cookie,
      'Accept': 'application/json',
    });

    if (r.status !== 200) {
      return res.status(r.status).json({ error: '데이터 없음 (status ' + r.status + ')' });
    }

    var d = JSON.parse(r.body);
    var result = d && d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0];
    var sd = result && result.summaryDetail;
    var ks = result && result.defaultKeyStatistics;

    if (!sd) return res.status(404).json({ error: '종목을 찾을 수 없어요' });

    var ttm = round2(sd.trailingPE && sd.trailingPE.raw);
    var fwd = round2(sd.forwardPE  && sd.forwardPE.raw);

    // forwardPE 없으면 previousClose / epsForward 계산
    if (fwd == null && sd.previousClose && sd.previousClose.raw && ks && ks.forwardEps && ks.forwardEps.raw > 0) {
      fwd = round2(sd.previousClose.raw / ks.forwardEps.raw);
    }

    return res.json({ source: 'yahoo', ttm, fwd });

  } catch(e) {
    return res.status(500).json({ error: '조회 실패: ' + e.message });
  }
};
