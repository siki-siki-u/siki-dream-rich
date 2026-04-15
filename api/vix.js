const https = require('https');

let cache = null;
let cacheTime = 0;
const CACHE_MS = 15 * 60 * 1000; // 15분 캐시

function fetchYahoo(range) {
  return new Promise(function(resolve, reject) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=${range}&includePrePost=false`;
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/%5EVIX?interval=1d&range=${range}&includePrePost=false`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
      timeout: 8000,
    };
    const req = https.request(opts, function(res) {
      let body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() { resolve({ status: res.statusCode, body }); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const range = (req.query && req.query.range) || '1mo';

  // 캐시 (range별)
  const cacheKey = range;
  if (cache && cache[cacheKey] && (Date.now() - cache[cacheKey].t) < CACHE_MS) {
    return res.json({ ...cache[cacheKey].data, cached: true });
  }

  try {
    const r = await fetchYahoo(range);
    if (r.status !== 200) throw new Error('Yahoo HTTP ' + r.status);

    const d = JSON.parse(r.body);
    const result = d.chart && d.chart.result && d.chart.result[0];
    if (!result) throw new Error('no data');

    const timestamps = result.timestamp || [];
    const closes = result.indicators.quote[0].close || [];
    const meta = result.meta || {};

    // 유효한 포인트만
    const pts = [];
    for (let i = 0; i < timestamps.length; i++) {
      if (closes[i] != null) pts.push({ ts: timestamps[i], v: closes[i] });
    }

    const current = meta.regularMarketPrice || closes.filter(Boolean).pop() || 0;
    const prev = meta.chartPreviousClose || pts[pts.length - 2]?.v || current;

    const payload = { current, prev, pts, range };

    if (!cache) cache = {};
    cache[cacheKey] = { data: payload, t: Date.now() };

    return res.json(payload);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
