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

    var [summary, dailyPrices, priceByYear, incomeSummary, trendSummary, incomeQ, earningsSummary, calSummary] = await Promise.all([
      fetchQuoteSummary(ticker, 'summaryDetail,defaultKeyStatistics,price', crumb, cookie),
      fetchChartPrices(ticker, '1d', '5mo', crumb, cookie),
      fetchAnnualPriceMap(ticker, crumb, cookie),
      fetchQuoteSummary(ticker, 'incomeStatementHistory', crumb, cookie).catch(function() { return null; }),
      fetchQuoteSummary(ticker, 'earningsTrend', crumb, cookie).catch(function() { return null; }),
      fetchQuoteSummary(ticker, 'incomeStatementHistoryQuarterly', crumb, cookie).catch(function() { return null; }),
      fetchQuoteSummary(ticker, 'earningsHistory', crumb, cookie).catch(function() { return null; }),
      fetchQuoteSummary(ticker, 'calendarEvents', crumb, cookie).catch(function() { return null; }),
    ]);

    var sd = summary.summaryDetail;
    var ks = summary.defaultKeyStatistics;
    var pr = summary.price;
    var et = trendSummary && trendSummary.earningsTrend;

    var currentPrice = pr && pr.regularMarketPrice && pr.regularMarketPrice.raw;
    // 배수 계산(PER/PSR/PEG)은 전일 종가 기준 — 금융 사이트 표준 (실시간 가격은 장중 계속 변해서 불일치)
    var prevClose = (pr && pr.regularMarketPreviousClose && pr.regularMarketPreviousClose.raw) ||
                   (sd && sd.previousClose && sd.previousClose.raw) ||
                   currentPrice;

    // earningsTrend 0y = 현재 회계연도 컨센서스 EPS → Seeking Alpha Non-GAAP FWD PE와 일치
    // 국내 종목 등 earningsTrend 없는 경우 forwardEps 폴백
    var trend0y = et && et.trend && et.trend.find(function(t) { return t.period === '0y'; });
    var trend1y = et && et.trend && et.trend.find(function(t) { return t.period === '+1y'; });
    var forwardEPS = (trend0y && trend0y.earningsEstimate && trend0y.earningsEstimate.avg && trend0y.earningsEstimate.avg.raw) ||
                    (ks && ks.forwardEps && ks.forwardEps.raw);

    var shares = ks && ks.sharesOutstanding && ks.sharesOutstanding.raw;

    // 연간 EPS 예상치 (Seeking Alpha Annual Estimates와 동일 소스)
    function fmtFiscalEnd(raw) {
      if (!raw) return null;
      var d = new Date(raw * 1000);
      return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }
    var annualEpsEstimates = [];
    [trend0y, trend1y].forEach(function(t) {
      if (!t) return;
      var eps = t.earningsEstimate && t.earningsEstimate.avg && t.earningsEstimate.avg.raw;
      if (eps == null) return;
      var endRaw = t.endDate && t.endDate.raw;
      var growth = t.earningsEstimate && t.earningsEstimate.growth && t.earningsEstimate.growth.raw;
      var numAnalysts = t.earningsEstimate && t.earningsEstimate.numberOfAnalysts && t.earningsEstimate.numberOfAnalysts.raw;
      var revEst = t.revenueEstimate && t.revenueEstimate.avg && t.revenueEstimate.avg.raw;
      var fpe = (eps > 0 && prevClose) ? r2(prevClose / eps) : null;
      var fpsr = (revEst && revEst > 0 && shares && prevClose) ? r2(prevClose * shares / revEst) : null;
      var fpeg = (fpe && growth != null && growth > 0) ? r2(fpe / (growth * 100)) : null;
      annualEpsEstimates.push({
        period: t.period,
        fiscalEnd: fmtFiscalEnd(endRaw),
        eps: r2(eps),
        growthPct: growth != null ? r2(growth * 100) : null,
        forwardPE: fpe,
        forwardPSR: fpsr,
        forwardPEG: fpeg,
        numAnalysts: numAnalysts || null,
      });
    });
    var pbr = r2(ks && ks.priceToBook && ks.priceToBook.raw);
    var forwardPE  = (forwardEPS && prevClose && forwardEPS > 0) ? r2(prevClose / forwardEPS)
                   : r2(sd && sd.forwardPE && sd.forwardPE.raw);
    var currency     = (pr && pr.currency) || 'USD';
    var companyName  = (pr && pr.shortName) || ticker;

    var rsiData    = calcRSI(dailyPrices);
    var currentRSI = rsiData.length ? rsiData[rsiData.length - 1].rsi : null;

    var incomeHistory = incomeSummary &&
      incomeSummary.incomeStatementHistory &&
      incomeSummary.incomeStatementHistory.incomeStatementHistory;
    var incomeHistoryQ = incomeQ &&
      incomeQ.incomeStatementHistoryQuarterly &&
      incomeQ.incomeStatementHistoryQuarterly.incomeStatementHistory;
    var earningsH = earningsSummary &&
      earningsSummary.earningsHistory &&
      earningsSummary.earningsHistory.history;
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

    // EPS 히스토리: 분기별 실적 + 증권사 추정치
    function qLabel(ts) {
      var d = new Date(ts * 1000);
      var q = Math.floor(d.getMonth() / 3) + 1;
      return d.getFullYear().toString().slice(2) + 'Q' + q;
    }

    // 회계연도 종료월 기준 FQ 라벨: "FQ2 2027 (Oct 2026)"
    // Yahoo는 "4월 말 결산"을 "5월 1일 UTC"로 저장 → 보정 없이 그대로 쓰면 모든 날짜가 일관성 있음
    var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var fyEndRaw = ks && ks.lastFiscalYearEnd && ks.lastFiscalYearEnd.raw;
    var fyEndMonth = fyEndRaw != null ? new Date(fyEndRaw * 1000).getUTCMonth() : null;
    function fqLabel(endRaw) {
      if (fyEndMonth == null || !endRaw) return null;
      var d = new Date(endRaw * 1000);
      var m = d.getUTCMonth(), y = d.getUTCFullYear();
      var fiscalYear = m <= fyEndMonth ? y : y + 1;
      var fyStartMonth = (fyEndMonth + 1) % 12;
      var qNum = Math.floor(((m - fyStartMonth + 12) % 12) / 3) + 1;
      return 'FQ' + qNum + ' ' + fiscalYear + ' (' + MONTHS[m] + ' ' + y + ')';
    }

    var epsHistory = [];

    // 마지막 실제 실적 날짜 (추정치 endDate 계산용)
    var lastActualRaw = null;

    // 1순위: earningsHistory — 주당 EPS 직접 제공, Yahoo가 4~6분기 반환
    if (earningsH && earningsH.length) {
      earningsH.slice().sort(function(a, b) {
        return (a.quarter && a.quarter.raw || 0) - (b.quarter && b.quarter.raw || 0);
      }).forEach(function(h) {
        if (!h.epsActual || h.epsActual.raw == null || !h.quarter || !h.quarter.raw) return;
        epsHistory.push({ year: fqLabel(h.quarter.raw) || qLabel(h.quarter.raw), eps: r2(h.epsActual.raw), type: 'actual' });
        lastActualRaw = h.quarter.raw;
      });
    }

    // 2순위 폴백: incomeStatementHistoryQuarterly (순이익 / 발행주식수)
    if (!epsHistory.length && incomeHistoryQ && shares) {
      incomeHistoryQ.slice().sort(function(a, b) {
        return (a.endDate && a.endDate.raw || 0) - (b.endDate && b.endDate.raw || 0);
      }).slice(-6).forEach(function(stmt) {
        var ni = (stmt.netIncomeApplicableToCommonShares && stmt.netIncomeApplicableToCommonShares.raw) ||
                 (stmt.netIncome && stmt.netIncome.raw);
        if (!ni || !stmt.endDate || !stmt.endDate.raw) return;
        epsHistory.push({ year: fqLabel(stmt.endDate.raw) || qLabel(stmt.endDate.raw), eps: r2(ni / shares), type: 'actual' });
        lastActualRaw = stmt.endDate.raw;
      });
    }

    // 증권사 추정치 (Yahoo Finance는 0q, +1q 2개만 제공)
    // endDate 없으면 fyEndRaw(마지막 회계연도 종료일) + 분기 오프셋으로 계산
    var Q91 = 91 * 24 * 60 * 60;
    if (et && et.trend) {
      var qOffset = 0;
      ['0q', '+1q'].forEach(function(period) {
        var t = et.trend.find(function(x) { return x.period === period; });
        if (!t || !t.earningsEstimate || !t.earningsEstimate.avg || !t.earningsEstimate.avg.raw) return;
        qOffset++;
        var endRaw = (t.endDate && t.endDate.raw) ||
                     (fyEndRaw ? fyEndRaw + qOffset * Q91 : null);
        var label = (endRaw && fqLabel(endRaw)) || (endRaw ? qLabel(endRaw) : period);
        if (!epsHistory.find(function(e) { return e.year === label; })) {
          epsHistory.push({ year: label, eps: r2(t.earningsEstimate.avg.raw), type: 'estimate' });
        }
      });
    }

    // 분기별 매출 히스토리 (incomeStatementHistoryQuarterly)
    var revenueHistory = [];
    if (incomeHistoryQ && incomeHistoryQ.length) {
      incomeHistoryQ.slice().sort(function(a, b) {
        return (a.endDate && a.endDate.raw || 0) - (b.endDate && b.endDate.raw || 0);
      }).slice(-6).forEach(function(stmt) {
        var rev = stmt.totalRevenue && stmt.totalRevenue.raw;
        if (rev == null || !stmt.endDate || !stmt.endDate.raw) return;
        revenueHistory.push({ year: fqLabel(stmt.endDate.raw) || qLabel(stmt.endDate.raw), revenue: rev, type: 'actual' });
      });
    }
    // 매출 추정치 (earningsTrend revenueEstimate)
    if (et && et.trend) {
      var rqOffset = 0;
      ['0q', '+1q'].forEach(function(period) {
        var t = et.trend.find(function(x) { return x.period === period; });
        if (!t || !t.revenueEstimate || !t.revenueEstimate.avg || !t.revenueEstimate.avg.raw) return;
        rqOffset++;
        var endRaw = (t.endDate && t.endDate.raw) ||
                     (fyEndRaw ? fyEndRaw + rqOffset * Q91 : null);
        var label = (endRaw && fqLabel(endRaw)) || (endRaw ? qLabel(endRaw) : period);
        if (!revenueHistory.find(function(e) { return e.year === label; })) {
          revenueHistory.push({ year: label, revenue: t.revenueEstimate.avg.raw, type: 'estimate' });
        }
      });
    }

    // 실적 발표 예정일 (calendarEvents) — FQ 라벨 적용
    var earningsDates = [];
    var calEv = calSummary && calSummary.calendarEvents && calSummary.calendarEvents.earnings;
    if (calEv && calEv.earningsDate && calEv.earningsDate.length) {
      // Yahoo는 보통 [최조기 예상, 최후기 예상] 2개 타임스탬프를 줌 → 첫 번째가 발표일 추정
      var d0 = new Date(calEv.earningsDate[0].raw * 1000);
      var q0EndRaw = fyEndRaw ? fyEndRaw + Q91 : null;
      var label0 = (q0EndRaw && fqLabel(q0EndRaw)) || (q0EndRaw ? qLabel(q0EndRaw) : null);
      if (label0) earningsDates.push({ period: '0q', label: label0, date: d0.toISOString().split('T')[0] });
      var d1 = new Date(d0.getTime() + 91 * 24 * 60 * 60 * 1000);
      var q1EndRaw = fyEndRaw ? fyEndRaw + 2 * Q91 : null;
      var label1 = (q1EndRaw && fqLabel(q1EndRaw)) || (q1EndRaw ? qLabel(q1EndRaw) : null);
      if (label1) earningsDates.push({ period: '+1q', label: label1, date: d1.toISOString().split('T')[0], estimated: true });
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
      revenueHistory,
      pbr,
      annualEpsEstimates,
      earningsDates,
      _dbg: { priceYears: Object.keys(priceByYear), incomeCount: incomeHistory ? incomeHistory.length : 0 },
    });

  } catch (e) {
    return res.status(500).json({ error: '조회 실패: ' + e.message });
  }
};
