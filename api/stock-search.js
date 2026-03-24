const https = require('https');
const url = require('url');

function get(rawUrl) {
  return new Promise(function(resolve, reject) {
    var opts = url.parse(rawUrl);
    opts.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
    };
    var req = https.get(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var q    = req.query.q;
  var type = req.query.type || 'US'; // KR, US, CRYPTO

  if (!q) return res.status(400).json({ error: '검색어 누락' });

  try {
    if (type === 'CRYPTO') {
      var cgUrl = 'https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(q);
      var cgRes = await get(cgUrl);
      var cgData = JSON.parse(cgRes.body);
      var coins = (cgData.coins || []).slice(0, 8).map(function(c) {
        return { ticker: c.id, name: c.name, sub: c.symbol.toUpperCase() };
      });
      return res.json({ results: coins });
    }

    var yfUrl = 'https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) + '&quotesCount=15&newsCount=0&lang=ko-KR';
    var yfRes = await get(yfUrl);
    if (yfRes.status !== 200) return res.json({ results: [] });

    var yfData = JSON.parse(yfRes.body);
    var quotes = (yfData.quotes || []);
    var results = [];

    quotes.forEach(function(item) {
      if (!item.symbol) return;
      var isKR = item.symbol.endsWith('.KS') || item.symbol.endsWith('.KQ');
      if (type === 'KR' && !isKR) return;
      if (type === 'US' && isKR) return;
      var ticker = isKR ? item.symbol.replace(/\.(KS|KQ)$/, '') : item.symbol;
      results.push({
        ticker: ticker,
        name: item.shortname || item.longname || ticker,
        sub: item.exchange || (isKR ? (item.symbol.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ') : ''),
      });
    });

    res.json({ results: results.slice(0, 8) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
