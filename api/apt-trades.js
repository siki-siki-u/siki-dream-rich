const https = require('https');
const http  = require('http');
const url   = require('url');
const qs    = require('querystring');

function httpGet(rawUrl) {
  return new Promise(function(resolve, reject) {
    var parsed = url.parse(rawUrl);
    var lib = parsed.protocol === 'https:' ? https : http;
    var opts = { hostname: parsed.hostname, path: parsed.path + (parsed.search||''), method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Accept': '*/*' } };
    var req = lib.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function httpPost(endpoint, postData) {
  return new Promise(function(resolve, reject) {
    var data = qs.stringify(postData);
    var parsed = url.parse(endpoint);
    var opts = {
      hostname: parsed.hostname,
      path: parsed.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Content-Length': Buffer.byteLength(data),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Origin': 'https://land.seoul.go.kr',
        'Referer': 'https://land.seoul.go.kr/land/rtms/rtmsApartment.do',
        'X-Requested-With': 'XMLHttpRequest',
      },
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(15000, function() { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

// land.seoul.go.kr 기간 조회
async function fetchFromSeoul(sigunguCd, lawdCd, startDt, endDt) {
  var bjdongCd = (lawdCd || '').padEnd(8, '0').slice(0, 8);
  var endpoints = [
    'https://land.seoul.go.kr/land/rtms/getRTMSAptList.do',
    'https://land.seoul.go.kr/land/rtms/selectRTMSAptList.do',
    'https://land.seoul.go.kr/land/rtms/rtmsAptListAjax.do',
  ];
  var postData = {
    sigunguCd: sigunguCd || lawdCd,
    bjdongCd: bjdongCd,
    startDt: startDt,
    endDt: endDt,
    pageIndex: 1,
    pageSize: 1000,
  };
  for (var ep of endpoints) {
    try {
      var r = await httpPost(ep, postData);
      if (r.status !== 200 || !r.body || r.body.length < 5) continue;
      var parsed = JSON.parse(r.body);
      // 다양한 응답 구조 지원
      var list = parsed.list || parsed.data || parsed.items || parsed.resultList
                 || (parsed.result && parsed.result.list) || (Array.isArray(parsed) ? parsed : null);
      if (list && Array.isArray(list) && list.length > 0) {
        return { ok: true, list: list, endpoint: ep };
      }
    } catch (e) { /* try next */ }
  }
  return { ok: false };
}

// data.go.kr 단일 월 조회
function fetchMonthDataGo(lawdCd, ym, key) {
  var apiUrl = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'
    + '?serviceKey=' + key
    + '&LAWD_CD=' + lawdCd
    + '&DEAL_YMD=' + ym
    + '&numOfRows=100&pageNo=1';
  return httpGet(apiUrl).then(function(result) {
    if (result.status !== 200) return [];
    var body = result.body;
    var items = [];
    var re = /<item>([\s\S]*?)<\/item>/g, m;
    while ((m = re.exec(body)) !== null) {
      var e = m[1];
      var gv = function(tag) { return ((e.match(new RegExp('<' + tag + '>[\\s\\S]*?<\\/' + tag + '>')) || [''])[0].replace(/<[^>]*>/g, '') || '').trim(); };
      var price = gv('dealAmount').replace(/,/g, '');
      if (!price || isNaN(Number(price))) continue;
      var yr = gv('dealYear'), mo = gv('dealMonth').padStart(2, '0'), dy = gv('dealDay').padStart(2, '0');
      items.push({
        aptNm: gv('aptNm'),
        price: Number(price),
        date: yr + '-' + mo + '-' + dy,
        floor: gv('floor'),
        area: gv('excluUseAr'),
      });
    }
    return items;
  }).catch(function() { return []; });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var q         = req.query || {};
  var b         = req.body  || {};
  var lawdCd    = q.lawdCd    || b.lawdCd    || '';
  var sigunguCd = q.sigunguCd || b.sigunguCd || lawdCd.slice(0, 5);
  var startDt   = q.startDt   || b.startDt   || '';
  var endDt     = q.endDt     || b.endDt     || '';
  var ym        = q.ym        || b.ym        || ''; // 레거시
  var key       = process.env.seoul_apt;

  if (!lawdCd) return res.status(400).json({ error: '파라미터 누락 (lawdCd)' });

  // 레거시: 단일 월(ym) 요청
  if (ym && !startDt) {
    if (!key) return res.status(500).json({ error: 'API 키 누락' });
    var legacyItems = await fetchMonthDataGo(lawdCd, ym, key);
    return res.json({
      items: legacyItems.map(function(i) {
        return { aptNm: i.aptNm, price: i.price, year: i.date.slice(0,4), month: i.date.slice(5,7), day: i.date.slice(8,10), floor: i.floor, area: i.area };
      }),
      count: legacyItems.length,
      source: 'datago-legacy',
    });
  }

  // 기간 기본값: 1년
  if (!startDt || !endDt) {
    var now = new Date();
    endDt = now.getFullYear() + String(now.getMonth() + 1).padStart(2,'0') + String(now.getDate()).padStart(2,'0');
    var s = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    startDt = s.getFullYear() + String(s.getMonth() + 1).padStart(2,'0') + String(s.getDate()).padStart(2,'0');
  }

  // 1. land.seoul.go.kr 시도
  var seoulRes = await fetchFromSeoul(sigunguCd, lawdCd, startDt, endDt);
  if (seoulRes.ok) {
    var items = seoulRes.list.map(function(i) {
      var rawPrice = (i.dealAmount || i.price || i.amt || '0').toString().replace(/,/g, '');
      var price = Number(rawPrice) || 0;
      var dateStr = i.dealDate
        || (i.dealYear && i.dealYear + '-' + String(i.dealMonth || 1).padStart(2,'0') + '-' + String(i.dealDay || 1).padStart(2,'0'))
        || '';
      return { aptNm: i.aptNm || i.aptName || i.name || '', price: price, date: dateStr, floor: String(i.floor || ''), area: String(i.excluUseAr || i.area || '') };
    }).filter(function(i) { return i.price > 0; });
    items.sort(function(a, b) { return b.date.localeCompare(a.date); });
    return res.json({ items: items, count: items.length, source: 'seoul' });
  }

  // 2. data.go.kr 폴백: 기간 내 월 목록 병렬 조회
  if (!key) return res.status(500).json({ error: 'API 키 누락 (seoul_apt). 폴백 data.go.kr도 사용 불가' });

  var months = [];
  var sd = new Date(parseInt(startDt.slice(0,4)), parseInt(startDt.slice(4,6)) - 1, 1);
  var ed = new Date(parseInt(endDt.slice(0,4)),   parseInt(endDt.slice(4,6))   - 1, 1);
  var cur = new Date(sd);
  while (cur <= ed && months.length < 24) {
    months.push(cur.getFullYear() + String(cur.getMonth() + 1).padStart(2,'0'));
    cur.setMonth(cur.getMonth() + 1);
  }

  var allResults = await Promise.all(months.map(function(m) { return fetchMonthDataGo(lawdCd, m, key); }));
  var allItems = [];
  allResults.forEach(function(r) { allItems = allItems.concat(r); });
  allItems.sort(function(a, b) { return b.date.localeCompare(a.date); });

  return res.json({ items: allItems, count: allItems.length, source: 'datago' });
};
