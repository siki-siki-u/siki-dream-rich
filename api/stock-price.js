const https = require('https');

function get(rawUrl) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(rawUrl);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
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

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var ticker = req.query.ticker;
  var type   = req.query.type || 'US';

  if (!ticker) return res.status(400).json({ error: 'ticker 누락' });

  try {
    // ── 암호화폐 ──
    if (type === 'CRYPTO') {
      var cgUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=' + encodeURIComponent(ticker.toLowerCase()) + '&vs_currencies=krw,usd&include_24hr_change=true';
      var cgRes = await get(cgUrl);
      if (cgRes.status !== 200) return res.status(500).json({ error: 'CoinGecko 오류: ' + cgRes.status });
      var cgData = JSON.parse(cgRes.body);
      var coin = cgData[ticker.toLowerCase()];
      if (!coin || !coin.krw) return res.status(404).json({ error: '코인 정보 없음' });
      return res.json({
        price: coin.krw, priceUsd: coin.usd,
        changeP: coin.krw_24h_change || 0,
        change: coin.krw * ((coin.krw_24h_change || 0) / 100),
        currency: 'KRW',
      });
    }

    var sym = type === 'KR' ? ticker + '.KS' : ticker;

    // ── 1차 시도: v7/finance/quote (더 실시간에 가까운 데이터) ──
    try {
      var quoteUrl = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=' +
        encodeURIComponent(sym) +
        '&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,currency';
      var qRes = await get(quoteUrl);
      if (qRes.status === 200) {
        var qData = JSON.parse(qRes.body);
        var qResult = qData && qData.quoteResponse && qData.quoteResponse.result && qData.quoteResponse.result[0];
        if (qResult && qResult.regularMarketPrice) {
          return res.json({
            price:   qResult.regularMarketPrice,
            change:  qResult.regularMarketChange  || 0,
            changeP: qResult.regularMarketChangePercent || 0,
            currency: qResult.currency || (type === 'US' ? 'USD' : 'KRW'),
            source: 'quote',
          });
        }
      }
    } catch (_) { /* quote 실패 시 chart로 폴백 */ }

    // ── 2차 폴백: v8/finance/chart ──
    var yfUrl = 'https://query2.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=1d';
    var yfRes = await get(yfUrl);
    if (yfRes.status !== 200) return res.status(500).json({ error: 'Yahoo Finance 오류: ' + yfRes.status });

    var yfData = JSON.parse(yfRes.body);
    var meta = yfData && yfData.chart && yfData.chart.result && yfData.chart.result[0] && yfData.chart.result[0].meta;
    if (!meta || !meta.regularMarketPrice) return res.status(404).json({ error: '시세 없음' });

    var price   = meta.regularMarketPrice;
    var prev    = meta.chartPreviousClose || meta.previousClose || price;
    var change  = price - prev;
    var changeP = prev ? (change / prev) * 100 : 0;
    res.json({ price, change, changeP, currency: meta.currency || (type === 'US' ? 'USD' : 'KRW'), source: 'chart' });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
