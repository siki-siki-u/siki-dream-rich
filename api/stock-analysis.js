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

// interval=1y 는 Yahoo에서 지원 안 함 → 3mo로 받아서 연도별 마지막 가격 맵 반환
async function fetchAnnualPriceMap(ticker, crumb, cookie) {
  var url = 'https://query2.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(ticker) + '?interval=3mo&range=7y' +
    '&crumb=' + encodeURIComponent(crumb);
  var r = await httpGet(url, { Cookie: cookie, Accept: 'application/json' });
  if (r.status !== 200) return {};
  try {
    var d = JSON.parse(r.body);
    var res = d.chart && d.chart.result && d.chart.result[0];
    if (!res || !res.timestamp) return {};
    var closes = res.indicators.quote[0].close;
    var byYear = {};
    res.timestamp.forEach(function(t, i) {
      if (closes[i] == null) return;
      var yr = new Date(t * 1000).getFullYear();
      byYear[yr] = closes[i]; // 같은 연도면 뒤(최신) 값으로 덮어씀
    });
    return byYear;
  } catch (e) { return {}; }
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

// GAAP 연간 순이익 / 현재 발행주식수 = EPS → 연말 주가로 PE → 평균
// (Yahoo 역사적 가격은 분할 반영 조정가, 현재 주식수도 분할 후 기준 → PE 정합)
function calcAvgPE5Y(priceByYear, incomeHistory, shares) {
  if (!incomeHistory || !incomeHistory.length || !shares || !Object.keys(priceByYear).length) return null;
  var peList = [];
  incomeHistory.forEach(function(stmt) {
    var ni = (stmt.netIncomeApplicableToCommonShares && stmt.netIncomeApplicableToCommonShares.raw) ||
             (stmt.netIncome && stmt.netIncome.raw);
    if (!ni || ni <= 0) return;
    var eps = ni / shares;
    if (eps <= 0) return;
    var stmtYear = new Date((stmt.endDate && stmt.endDate.raw) * 1000).getFullYear();
    // 해당 연도 가격이 없으면 ±1년 내에서 찾기
    var price = priceByYear[stmtYear] || priceByYear[stmtYear - 1] || priceByYear[stmtYear + 1];
    if (!price) return;
    var pe = price / eps;
    if (pe > 0 && pe < 2000) peList.push(Math.round(pe * 100) / 100);
  });
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

    var [summary, dailyPrices, priceByYear, incomeSummary, trendSummary] = await Promise.all([
      fetchQuoteSummary(ticker, 'summaryDetail,defaultKeyStatistics,price', crumb, cookie),
      fetchChartPrices(ticker, '1d', '5mo', crumb, cookie),
      fetchAnnualPriceMap(ticker, crumb, cookie),
      fetchQuoteSummary(ticker, 'incomeStatementHistory,incomeStatementHistoryQuarterly', crumb, cookie),
      fetchQuoteSummary(ticker, 'earningsTrend', crumb, cookie).catch(function() { return null; }),
    ]);

    var sd = summary.summaryDetail;
    var ks = summary.defaultKeyStatistics;
    var pr = summary.price;
    var et = trendSummary && trendSummary.earningsTrend;

    var currentPrice = pr && pr.regularMarketPrice && pr.regularMarketPrice.raw;

    // earningsTrend 0y = 현재 회계연도 컨센서스 EPS → Seeking Alpha Non-GAAP FWD PE와 일치
    // 국내 종목 등 earningsTrend 없는 경우 forwardEps 폴백
    var trend0y = et && et.trend && et.trend.find(function(t) { return t.period === '0y'; });
    var forwardEPS = (trend0y && trend0y.earningsEstimate && trend0y.earningsEstimate.avg && trend0y.earningsEstimate.avg.raw) ||
                    (ks && ks.forwardEps && ks.forwardEps.raw);
    var forwardPE  = (forwardEPS && currentPrice && forwardEPS > 0) ? r2(currentPrice / forwardEPS)
                   : r2(sd && sd.forwardPE && sd.forwardPE.raw);
    var currency     = (pr && pr.currency) || 'USD';
    var companyName  = (pr && pr.shortName) || ticker;

    var shares = ks && ks.sharesOutstanding && ks.sharesOutstanding.raw;

    var rsiData    = calcRSI(dailyPrices);
    var currentRSI = rsiData.length ? rsiData[rsiData.length - 1].rsi : null;

    var incomeHistory = incomeSummary &&
      incomeSummary.incomeStatementHistory &&
      incomeSummary.incomeStatementHistory.incomeStatementHistory;
    var avgPE5Y = calcAvgPE5Y(priceByYear, incomeHistory, shares);

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

    // EPS 히스토리: 분기별 실적(GAAP) + 분기 증권사 추정치
    var incomeHistoryQ = incomeSummary &&
      incomeSummary.incomeStatementHistoryQuarterly &&
      incomeSummary.incomeStatementHistoryQuarterly.incomeStatementHistory;

    function qLabel(ts) {
      var d = new Date(ts * 1000);
      var q = Math.floor(d.getMonth() / 3) + 1;
      return d.getFullYear().toString().slice(2) + 'Q' + q;
    }

    var epsHistory = [];
    if (incomeHistoryQ && shares) {
      var sortedQ = incomeHistoryQ.slice().sort(function(a, b) {
        return (a.endDate && a.endDate.raw || 0) - (b.endDate && b.endDate.raw || 0);
      });
      sortedQ.slice(-8).forEach(function(stmt) {
        var ni = (stmt.netIncomeApplicableToCommonShares && stmt.netIncomeApplicableToCommonShares.raw) ||
                 (stmt.netIncome && stmt.netIncome.raw);
        if (!ni || !stmt.endDate || !stmt.endDate.raw) return;
        var eps = r2(ni / shares);
        epsHistory.push({ year: qLabel(stmt.endDate.raw), eps: eps, type: 'actual' });
      });
    }
    if (et && et.trend) {
      ['0q', '+1q'].forEach(function(period) {
        var t = et.trend.find(function(x) { return x.period === period; });
        if (!t || !t.earningsEstimate || !t.earningsEstimate.avg || !t.earningsEstimate.avg.raw) return;
        var label = (t.endDate && t.endDate.raw) ? qLabel(t.endDate.raw) : (period === '0q' ? '현재Q' : '다음Q');
        if (!epsHistory.find(function(e) { return e.year === label; })) {
          epsHistory.push({ year: label, eps: r2(t.earningsEstimate.avg.raw), type: 'estimate' });
        }
      });
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
      epsHistory,
      _dbg: { priceYears: Object.keys(priceByYear), incomeCount: incomeHistory ? incomeHistory.length : 0 },
    });

  } catch (e) {
    return res.status(500).json({ error: '조회 실패: ' + e.message });
  }
};
