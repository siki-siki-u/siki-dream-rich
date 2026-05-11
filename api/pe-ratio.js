const https = require('https');

function get(rawUrl, extraHeaders) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(rawUrl);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: Object.assign({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      }, extraHeaders || {}),
    };
    var req = https.get(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

function round2(v) {
  return v != null ? Number(v).toFixed(2) : null;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker) return res.status(400).json({ error: 'ticker 누락' });

  var errors = [];

  // ── 1차: Yahoo Finance v7 quote (가장 안정적, crumb 불필요) ──
  try {
    var url1 = 'https://query1.finance.yahoo.com/v7/finance/quote' +
      '?symbols=' + encodeURIComponent(ticker) +
      '&fields=trailingPE,forwardPE,epsTrailingTwelveMonths,epsForward,regularMarketPrice' +
      '&corsDomain=finance.yahoo.com&formatted=false&region=US&lang=en-US';
    var r1 = await get(url1);
    if (r1.status === 200) {
      var d1 = JSON.parse(r1.body);
      var q = d1 && d1.quoteResponse && d1.quoteResponse.result && d1.quoteResponse.result[0];
      if (q) {
        var ttm = round2(q.trailingPE);
        var fwd = round2(q.forwardPE);
        // forwardPE 없으면 price / epsForward 로 직접 계산
        if (fwd == null && q.regularMarketPrice && q.epsForward && q.epsForward > 0) {
          fwd = round2(q.regularMarketPrice / q.epsForward);
        }
        if (ttm != null || fwd != null) {
          return res.json({ source: 'yahoo', ttm, fwd });
        }
      }
    }
    errors.push('v7/quote status=' + r1.status);
  } catch(e) { errors.push('v7/quote: ' + e.message); }

  // ── 2차: Yahoo Finance query2 v7 ──
  try {
    var url2 = 'https://query2.finance.yahoo.com/v7/finance/quote' +
      '?symbols=' + encodeURIComponent(ticker) +
      '&fields=trailingPE,forwardPE,epsTrailingTwelveMonths,epsForward,regularMarketPrice' +
      '&corsDomain=finance.yahoo.com&formatted=false&region=US&lang=en-US';
    var r2 = await get(url2);
    if (r2.status === 200) {
      var d2 = JSON.parse(r2.body);
      var q2 = d2 && d2.quoteResponse && d2.quoteResponse.result && d2.quoteResponse.result[0];
      if (q2) {
        var ttm2 = round2(q2.trailingPE);
        var fwd2 = round2(q2.forwardPE);
        if (fwd2 == null && q2.regularMarketPrice && q2.epsForward && q2.epsForward > 0) {
          fwd2 = round2(q2.regularMarketPrice / q2.epsForward);
        }
        if (ttm2 != null || fwd2 != null) {
          return res.json({ source: 'yahoo', ttm: ttm2, fwd: fwd2 });
        }
      }
    }
    errors.push('q2/v7 status=' + r2.status);
  } catch(e) { errors.push('q2/v7: ' + e.message); }

  // ── 3차: Yahoo Finance quoteSummary (v10) ──
  try {
    var url3 = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' +
      encodeURIComponent(ticker) + '?modules=summaryDetail,defaultKeyStatistics';
    var r3 = await get(url3, { 'Cookie': '' });
    if (r3.status === 200) {
      var d3 = JSON.parse(r3.body);
      var res3 = d3 && d3.quoteSummary && d3.quoteSummary.result && d3.quoteSummary.result[0];
      var sd = res3 && res3.summaryDetail;
      var ks = res3 && res3.defaultKeyStatistics;
      if (sd) {
        var ttm3 = round2(sd.trailingPE && sd.trailingPE.raw);
        var fwd3 = round2(sd.forwardPE  && sd.forwardPE.raw);
        if (fwd3 == null && ks && ks.forwardEps && sd.previousClose) {
          fwd3 = round2(sd.previousClose.raw / ks.forwardEps.raw);
        }
        if (ttm3 != null || fwd3 != null) {
          return res.json({ source: 'yahoo', ttm: ttm3, fwd: fwd3 });
        }
      }
    }
    errors.push('quoteSummary status=' + r3.status);
  } catch(e) { errors.push('quoteSummary: ' + e.message); }

  return res.status(404).json({ error: '데이터를 가져오지 못했어요', detail: errors.join(' | ') });
};
