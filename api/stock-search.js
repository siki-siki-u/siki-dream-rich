const https = require('https');

// 한글 종목명 → 영어 매핑 (US/CRYPTO 전용. KR은 네이버 증권 자동완성이 한글을 그대로 처리함)
var KO_MAP = {
  '애플':'apple','삼성':'samsung','테슬라':'tesla','엔비디아':'nvidia',
  '마이크로소프트':'microsoft','구글':'google','알파벳':'alphabet',
  '아마존':'amazon','메타':'meta','넷플릭스':'netflix','팔란티어':'palantir',
  '브로드컴':'broadcom','TSMC':'tsmc','코카콜라':'coca cola','존슨앤존슨':'johnson johnson',
  '비자':'visa','마스터카드':'mastercard','JP모건':'jpmorgan','버크셔':'berkshire',
  '유나이티드헬스':'unitedhealth','엑손모빌':'exxon','쉐브론':'chevron',
  '비트코인':'bitcoin','이더리움':'ethereum','리플':'ripple','솔라나':'solana',
  '도지':'dogecoin','에이다':'cardano',
};

function get(rawUrl) {
  return new Promise(function(resolve, reject) {
    var parsed = new URL(rawUrl);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
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
    req.setTimeout(8000, function() { req.destroy(); reject(new Error('timeout')); });
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  var q    = (req.query.q || '').trim();
  var type = req.query.type || 'US';

  if (!q) return res.status(400).json({ error: '검색어 누락' });

  try {
    // ── 국내 주식: 네이버 증권 자동완성 (한글 이름 그대로 검색, 인증/IP 제한 없음) ──
    if (type === 'KR') {
      var naverUrl = 'https://ac.stock.naver.com/ac?q=' + encodeURIComponent(q) + '&target=stock';
      var naverRes = await get(naverUrl);
      if (naverRes.status !== 200) return res.json({ results: [], debug: 'Naver status: ' + naverRes.status });
      var naverData = JSON.parse(naverRes.body);
      var items = (naverData.items || [])
        .filter(function(it) { return it.category === 'stock' && it.nationCode === 'KOR'; })
        .slice(0, 8)
        .map(function(it) {
          return { ticker: it.code, name: it.name, sub: it.typeName || it.typeCode };
        });
      return res.json({ results: items });
    }

    // 한글 → 영어 변환 (US/CRYPTO)
    var searchQ = q;
    for (var ko in KO_MAP) {
      if (q.includes(ko)) { searchQ = KO_MAP[ko]; break; }
    }

    if (type === 'CRYPTO') {
      var cgRes = await get('https://api.coingecko.com/api/v3/search?query=' + encodeURIComponent(searchQ));
      var cgData = JSON.parse(cgRes.body);
      var coins = (cgData.coins || []).slice(0, 8).map(function(c) {
        return { ticker: c.id, name: c.name, sub: c.symbol.toUpperCase() };
      });
      return res.json({ results: coins });
    }

    var yfUrl = 'https://query2.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(searchQ) + '&quotesCount=15&newsCount=0&enableFuzzyQuery=true';
    var yfRes = await get(yfUrl);

    if (yfRes.status !== 200) {
      return res.json({ results: [], debug: 'YF status: ' + yfRes.status });
    }

    var yfData = JSON.parse(yfRes.body);
    var quotes = yfData.quotes || [];
    var results = [];

    quotes.forEach(function(item) {
      if (!item.symbol) return;
      if (item.quoteType === 'MUTUALFUND' || item.quoteType === 'INDEX') return;
      var isKR = item.symbol.endsWith('.KS') || item.symbol.endsWith('.KQ');
      if (isKR) return; // KR은 위에서 네이버로 처리
      results.push({ ticker: item.symbol, name: item.shortname || item.longname || item.symbol, sub: item.exchange || item.exchDisp || '' });
    });

    res.json({ results: results.slice(0, 8) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
