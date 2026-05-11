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
      }, extraHeaders || {}),
    };
    var req = https.get(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(9000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker) return res.status(400).json({ error: 'ticker 누락' });

  // 1차: Seeking Alpha 내부 finance API
  try {
    var saUrl = 'https://finance.api.seekingalpha.com/v3/symbols/' +
      encodeURIComponent(ticker.toLowerCase()) +
      '/metrics?fields[]=p_e_nongaap_fwd&fields[]=p_e_nongaap_ttm';
    var saRes = await get(saUrl, {
      'Referer': 'https://seekingalpha.com/',
      'Origin':  'https://seekingalpha.com',
    });
    if (saRes.status === 200) {
      var saData = JSON.parse(saRes.body);
      var attrs = saData && saData.data && saData.data.attributes;
      if (attrs && (attrs.p_e_nongaap_ttm != null || attrs.p_e_nongaap_fwd != null)) {
        return res.json({
          source: 'seekingalpha',
          ttm: attrs.p_e_nongaap_ttm != null ? Number(attrs.p_e_nongaap_ttm).toFixed(2) : null,
          fwd: attrs.p_e_nongaap_fwd  != null ? Number(attrs.p_e_nongaap_fwd).toFixed(2)  : null,
        });
      }
    }
  } catch(e) {}

  // 2차: Yahoo Finance quoteSummary (trailingPE / forwardPE)
  try {
    var yfUrl = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/' +
      encodeURIComponent(ticker) +
      '?modules=summaryDetail';
    var yfRes = await get(yfUrl);
    if (yfRes.status === 200) {
      var yfData = JSON.parse(yfRes.body);
      var sd = yfData &&
               yfData.quoteSummary &&
               yfData.quoteSummary.result &&
               yfData.quoteSummary.result[0] &&
               yfData.quoteSummary.result[0].summaryDetail;
      if (sd) {
        return res.json({
          source: 'yahoo',
          ttm: sd.trailingPE && sd.trailingPE.raw != null ? Number(sd.trailingPE.raw).toFixed(2) : null,
          fwd: sd.forwardPE  && sd.forwardPE.raw  != null ? Number(sd.forwardPE.raw).toFixed(2)  : null,
        });
      }
    }
  } catch(e) {}

  return res.status(404).json({ error: '데이터를 가져오지 못했어요' });
};
