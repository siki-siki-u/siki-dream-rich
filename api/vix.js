const https = require('https');

let cache = null;
let cacheTime = 0;
const CACHE_MS = 15 * 60 * 1000; // 15분 캐시

function fetchYahoo(ticker, range) {
  const encoded = encodeURIComponent(ticker);
  return new Promise(function(resolve, reject) {
    const opts = {
      hostname: 'query1.finance.yahoo.com',
      path: `/v8/finance/chart/${encoded}?interval=1d&range=${range}&includePrePost=false`,
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

// ── 금리 (기준금리 + 국채) ──
function fetchText(url) {
  return new Promise(function(resolve, reject) {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 10000,
    }, function(res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function(c) { body += c; });
      res.on('end', function() { resolve({ status: res.statusCode, body }); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
  });
}

let policyCache = null;
let policyCacheTime = 0;
const POLICY_CACHE_MS = 6 * 60 * 60 * 1000; // 6시간 캐시 (기준금리는 자주 안 바뀜)

// 한국은행 기준금리 변경 이력 → [{d:'YYYY-MM-DD', v}] (오래된 순)
async function fetchKrPolicy() {
  const r = await fetchText('https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643');
  if (r.status !== 200) throw new Error('BOK HTTP ' + r.status);
  const cells = [];
  const re = /<td[^>]*>\s*([^<]*?)\s*<\/td>/g;
  let m;
  while ((m = re.exec(r.body))) cells.push(m[1]);
  const out = [];
  for (let i = 0; i + 2 < cells.length; i++) {
    const md = /^(\d{1,2})월\s*(\d{1,2})일$/.exec(cells[i + 1]);
    if (/^\d{4}$/.test(cells[i]) && md && /^\d+(\.\d+)?$/.test(cells[i + 2])) {
      out.push({ d: cells[i] + '-' + md[1].padStart(2, '0') + '-' + md[2].padStart(2, '0'), v: parseFloat(cells[i + 2]) });
      i += 2;
    }
  }
  if (!out.length) throw new Error('BOK 파싱 실패');
  return out.sort(function(a, b) { return a.d < b.d ? -1 : 1; });
}

// 연준 기준금리(목표범위) 변경 이력 → [{d, lo, hi}] (오래된 순)
async function fetchUsPolicy() {
  const r = await fetchText('https://www.federalreserve.gov/monetarypolicy/openmarket.htm');
  if (r.status !== 200) throw new Error('Fed HTTP ' + r.status);
  const months = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 };
  const out = [];
  const sections = r.body.split(/<h4>(\d{4})<\/h4>/);
  for (let s = 1; s + 1 < sections.length; s += 2) {
    const year = sections[s];
    const table = sections[s + 1].split('</table>')[0];
    const rows = table.match(/<tr>[\s\S]*?<\/tr>/g) || [];
    rows.forEach(function(row) {
      const tds = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(function(td) {
        return td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      });
      if (tds.length < 4) return;
      const dm = /^([A-Za-z]+)\s+(\d{1,2})/.exec(tds[0]);
      const lv = /^([\d.]+)(?:\s*-\s*([\d.]+))?/.exec(tds[3]);
      if (!dm || !months[dm[1]] || !lv) return;
      const lo = parseFloat(lv[1]);
      const hi = lv[2] != null ? parseFloat(lv[2]) : lo;
      out.push({ d: year + '-' + String(months[dm[1]]).padStart(2, '0') + '-' + dm[2].padStart(2, '0'), lo, hi });
    });
  }
  if (!out.length) throw new Error('Fed 파싱 실패');
  return out.sort(function(a, b) { return a.d < b.d ? -1 : 1; });
}

async function getYieldSeries(ticker, range) {
  const interval = (range === '5y' || range === '10y') ? '1wk' : '1d';
  const encoded = encodeURIComponent(ticker);
  const r = await fetchText(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=${interval}&range=${range}&includePrePost=false`);
  if (r.status !== 200) throw new Error('Yahoo HTTP ' + r.status);
  const result = JSON.parse(r.body).chart.result[0];
  const ts = result.timestamp || [];
  const closes = result.indicators.quote[0].close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) {
    if (closes[i] != null) pts.push({ ts: ts[i], v: Math.round(closes[i] * 1000) / 1000 });
  }
  const current = result.meta.regularMarketPrice || (pts.length ? pts[pts.length - 1].v : null);
  return { current, pts };
}

async function handleRates(req, res) {
  const range = ['1y', '2y', '5y', '10y'].includes(req.query && req.query.range) ? req.query.range : '1y';
  const cacheKey = 'rates_' + range;
  if (cache && cache[cacheKey] && (Date.now() - cache[cacheKey].t) < CACHE_MS) {
    return res.json({ ...cache[cacheKey].data, cached: true });
  }

  // 기준금리는 한쪽이 실패해도 나머지는 보여주도록 개별 처리
  if (!policyCache || (Date.now() - policyCacheTime) > POLICY_CACHE_MS) {
    const [kr, us] = await Promise.allSettled([fetchKrPolicy(), fetchUsPolicy()]);
    const next = {
      kr: kr.status === 'fulfilled' ? kr.value : (policyCache && policyCache.kr) || null,
      us: us.status === 'fulfilled' ? us.value : (policyCache && policyCache.us) || null,
    };
    if (kr.status === 'fulfilled' && us.status === 'fulfilled') policyCacheTime = Date.now();
    policyCache = next;
  }

  const [y10, y30, y3m] = await Promise.allSettled([
    getYieldSeries('^TNX', range), getYieldSeries('^TYX', range), getYieldSeries('^IRX', range),
  ]);
  const pick = function(p) { return p.status === 'fulfilled' ? p.value : null; };
  const payload = {
    range,
    kr: policyCache.kr,
    us: policyCache.us,
    y10: pick(y10),
    y30: pick(y30),
    y3m: pick(y3m),
  };
  if (!payload.kr && !payload.us && !payload.y10 && !payload.y30 && !payload.y3m) {
    return res.status(500).json({ error: '금리 데이터를 가져오지 못했어요' });
  }

  if (!cache) cache = {};
  cache[cacheKey] = { data: payload, t: Date.now() };
  return res.json(payload);
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.query && req.query.action === 'rates') {
    try { return await handleRates(req, res); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

  const ticker = (req.query && req.query.ticker) || '^VIX';
  const range = (req.query && req.query.range) || '1mo';

  // 캐시 (ticker+range별)
  const cacheKey = ticker + '_' + range;
  if (cache && cache[cacheKey] && (Date.now() - cache[cacheKey].t) < CACHE_MS) {
    return res.json({ ...cache[cacheKey].data, cached: true });
  }

  try {
    const r = await fetchYahoo(ticker, range);
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
