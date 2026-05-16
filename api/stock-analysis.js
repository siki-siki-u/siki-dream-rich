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
    req.setTimeout(12000, function() { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function extractCookies(h) {
  if (!h) return '';
  var arr = Array.isArray(h) ? h : [h];
  return arr.map(function(c) { return c.split(';')[0]; }).join('; ');
}

async function getCrumb() {
  var r1 = await httpGet('https://fc.yahoo.com');
  var cookie = extractCookies(r1.headers['set-cookie']);
  if (!cookie) {
    r1 = await httpGet('https://finance.yahoo.com/', { 'Accept': 'text/html' });
    cookie = extractCookies(r1.headers['set-cookie']);
  }
  var r2 = await httpGet('https://query2.finance.yahoo.com/v1/test/getcrumb', { 'Cookie': cookie });
  var crumb = r2.body.trim();
  if (!crumb || crumb.length < 3) throw new Error('crumb 취득 실패');
  return { crumb, cookie };
}

async function fetchQuoteSummary(ticker, modules, crumb, cookie) {
  var url = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' +
    encodeURIComponent(ticker) + '?modules=' + modules + '&crumb=' + encodeURIComponent(crumb);
  var r = await httpGet(url, { Cookie: cookie, Accept: 'application/json' });
  if (r.status !== 200) throw new Error('quoteSummary ' + r.status);
  var d = JSON.parse(r.body);
  var result = d.quoteSummary && d.quoteSummary.result && d.quoteSummary.result[0];
  if (!result) throw new Error('종목을 찾을 수 없어요');
  return result;
}

async function fetchChartPrices(ticker, interval, range, crumb, cookie) {
  var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(ticker) + '?interval=' + interval + '&range=' + range +
    '&crumb=' + encodeURIComponent(crumb);
  var r = await httpGet(url, { Cookie: cookie, Accept: 'application/json' });
  if (r.status !== 200) return [];
  var d = JSON.parse(r.body);
  var res = d.chart && d.chart.result && d.chart.result[0];
  if (!res || !res.timestamp) return [];
  var closes = res.indicators.quote[0].close;
  return res.timestamp.map(function(t, i) {
    return { date: new Date(t * 1000).toISOString().split('T')[0], close: closes[i] };
  }).filter(function(p) { return p.close != null; });
}

// Non-GAAP EPS 실적값을 chart events=earnings 에서 가져옴
// Yahoo epsActual = 애널리스트 컨센서스 기준 Non-GAAP 조정 EPS
async function fetchEarningsEvents(ticker, crumb, cookie) {
  // interval=1d 필수 — 3mo 인터벌에서는 events 블록이 누락될 수 있음
  var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(ticker) + '?interval=1d&range=6y&events=earnings' +
    '&crumb=' + encodeURIComponent(crumb);
  var r = await httpGet(url, { Cookie: cookie, Accept: 'application/json' });
  if (r.status !== 200) return [];
  try {
    var d = JSON.parse(r.body);
    var res = d.chart && d.chart.result && d.chart.result[0];
    if (!res || !res.events || !res.events.earnings) return [];
    var raw = res.events.earnings;
    var items = Array.isArray(raw) ? raw : Object.values(raw);
    return items
      .map(function(e) {
        var dt = new Date(e.date * 1000);
        var eps = e.epsActual != null ? e.epsActual
                : e.actual    != null ? e.actual
                : null;
        return { date: dt.toISOString().split('T')[0], eps: eps };
      })
      .filter(function(e) { return e.eps != null; })
      .sort(function(a, b) { return a.date.localeCompare(b.date); });
  } catch (e) { return []; }
}

// Wilder's smoothed RSI
function calcRSI(prices, period) {
  period = period || 14;
  if (prices.length < period + 1) return [];
  var changes = [];
  for (var i = 1; i < prices.length; i++) changes.push(prices[i].close - prices[i - 1].close);
  var avgGain = 0, avgLoss = 0;
  for (var i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i] / period;
    else avgLoss += Math.abs(changes[i]) / period;
  }
  var out = [];
  function rsiVal(g, l) { return l === 0 ? 100 : Math.round((100 - 100 / (1 + g / l)) * 100) / 100; }
  out.push({ date: prices[period].date, rsi: rsiVal(avgGain, avgLoss), close: prices[period].close });
  for (var i = period; i < changes.length; i++) {
    var g = changes[i] > 0 ? changes[i] : 0;
    var l = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out.push({ date: prices[i + 1].date, rsi: rsiVal(avgGain, avgLoss), close: prices[i + 1].close });
  }
  return out.slice(-65); // last ~3 months of trading days
}

// 각 연말 기준 TTM Non-GAAP EPS(직전 4분기 합산) → 연말 주가로 PE → 5년 평균
function calcAvgPE5Y(annualPrices, earningsEvents) {
  if (!earningsEvents || !earningsEvents.length || !annualPrices.length) return null;
  var currentYear = new Date().getFullYear();
  var peList = [];
  for (var year = currentYear - 1; year >= currentYear - 5; year--) {
    var yearEndDate = year + '-12-31';
    var prior = earningsEvents.filter(function(e) { return e.date <= yearEndDate; });
    if (prior.length < 3) continue;
    var last4 = prior.slice(-4); // 3~4개 분기로 TTM 근사
    var ttmEPS = last4.reduce(function(s, e) { return s + e.eps; }, 0);
    if (ttmEPS <= 0) continue;
    var best = annualPrices.reduce(function(b, p) {
      return Math.abs(new Date(p.date).getFullYear() - year) <
             Math.abs(new Date(b.date).getFullYear() - year) ? p : b;
    }, annualPrices[0]);
    if (!best || !best.close) continue;
    var pe = best.close / ttmEPS;
    if (pe > 0 && pe < 1000) peList.push(Math.round(pe * 100) / 100);
  }
  if (!peList.length) return null;
  return Math.round(peList.reduce(function(a, b) { return a + b; }, 0) / peList.length * 100) / 100;
}

function r2(v) { return (v != null && !isNaN(v)) ? Math.round(v * 100) / 100 : null; }

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var ticker = (req.query.ticker || '').toUpperCase().trim();
  if (!ticker) return res.status(400).json({ error: 'ticker 누락' });

  try {
    var { crumb, cookie } = await getCrumb();

    // lite=1: P/E only mode (replaces pe-ratio.js)
    if (req.query.lite === '1') {
      var qs = await fetchQuoteSummary(ticker, 'summaryDetail,defaultKeyStatistics', crumb, cookie);
      var sd2 = qs.summaryDetail, ks2 = qs.defaultKeyStatistics;
      var ttm = r2(sd2 && sd2.trailingPE && sd2.trailingPE.raw);
      var fwd = r2(sd2 && sd2.forwardPE  && sd2.forwardPE.raw);
      if (fwd == null && sd2 && sd2.previousClose && sd2.previousClose.raw && ks2 && ks2.forwardEps && ks2.forwardEps.raw > 0) {
        fwd = r2(sd2.previousClose.raw / ks2.forwardEps.raw);
      }
      return res.json({ source: 'yahoo', ttm, fwd });
    }

    var [summary, dailyPrices, annualPrices, earningsEvents] = await Promise.all([
      fetchQuoteSummary(ticker, 'summaryDetail,defaultKeyStatistics,price', crumb, cookie),
      fetchChartPrices(ticker, '1d', '5mo', crumb, cookie),
      fetchChartPrices(ticker, '1y', '6y', crumb, cookie),
      fetchEarningsEvents(ticker, crumb, cookie),
    ]);

    var sd = summary.summaryDetail;
    var ks = summary.defaultKeyStatistics;
    var pr = summary.price;

    var currentPrice = pr && pr.regularMarketPrice && pr.regularMarketPrice.raw;
    var forwardEPS   = ks && ks.forwardEps && ks.forwardEps.raw;  // Yahoo forwardEps = Non-GAAP
    var forwardPE    = (sd && sd.forwardPE && sd.forwardPE.raw) ||
      (forwardEPS && currentPrice && forwardEPS > 0 ? r2(currentPrice / forwardEPS) : null);
    var currency     = (pr && pr.currency) || 'USD';
    var companyName  = (pr && pr.shortName) || ticker;

    var rsiData    = calcRSI(dailyPrices);
    var currentRSI = rsiData.length ? rsiData[rsiData.length - 1].rsi : null;

    var avgPE5Y = calcAvgPE5Y(annualPrices, earningsEvents);

    var fairValue = (forwardEPS && avgPE5Y) ? r2(forwardEPS * avgPE5Y) : null;

    var valuation = null, valuationKR = null;
    if (forwardPE && avgPE5Y) {
      var gap = r2(((forwardPE - avgPE5Y) / avgPE5Y) * 100);
      if (forwardPE < avgPE5Y) {
        valuation = 'undervalued';
        valuationKR = '저평가 (' + Math.abs(gap) + '% 낮음)';
      } else {
        valuation = 'overvalued';
        valuationKR = '고평가 (' + Math.abs(gap) + '% 높음)';
      }
    }

    return res.json({
      ticker, companyName, currency,
      currentPrice:  r2(currentPrice),
      forwardEPS:    r2(forwardEPS),
      forwardPE:     r2(forwardPE),
      avgPE5Y,
      fairValue,
      valuation,
      valuationKR,
      currentRSI,
      rsiData,
      _dbg: { earningsCount: earningsEvents.length },
    });

  } catch (e) {
    return res.status(500).json({ error: '조회 실패: ' + e.message });
  }
};
