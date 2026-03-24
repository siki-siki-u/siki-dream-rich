const https = require('https');
const url = require('url');

function get(rawUrl) {
  return new Promise(function(resolve, reject) {
    var opts = url.parse(rawUrl);
    opts.headers = { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' };
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

  var lawdCd = req.query.lawdCd;
  var ym     = req.query.ym;
  var key    = req.query.key;  // 포털에서 받은 키 그대로 (인코딩 없이)

  if (!lawdCd || !ym || !key) {
    return res.status(400).json({ error: '파라미터 누락' });
  }

  // 키에 이미 특수문자가 있으면 그대로, 없으면 그대로 사용
  // 포털 "일반 인증키(Decoding)" 사용 권장
  var apiUrl = 'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'
    + '?serviceKey=' + encodeURIComponent(key)
    + '&LAWD_CD=' + lawdCd
    + '&DEAL_YMD=' + ym
    + '&numOfRows=100&pageNo=1';

  try {
    var result = await get(apiUrl);
    if (result.status !== 200) {
      return res.status(500).json({ error: 'API 오류: HTTP ' + result.status, body: result.body.slice(0, 300) });
    }

    // XML 파싱
    var body = result.body;
    var errMsg = (body.match(/<errMsg>(.*?)<\/errMsg>/) || [])[1];
    var returnReasonCode = (body.match(/<returnReasonCode>(.*?)<\/returnReasonCode>/) || [])[1] || '';
    if (errMsg && errMsg !== '정상') {
      return res.status(500).json({ error: '공공API 오류: ' + errMsg + ' ('+returnReasonCode+')', raw: body.slice(0,500) });
    }

    var items = [];
    var re = /<item>([\s\S]*?)<\/item>/g, m;
    while ((m = re.exec(body)) !== null) {
      var e = m[1];
      var get_val = function(tag) { return ((e.match(new RegExp('<'+tag+'>[\\s\\S]*?<\\/'+tag+'>')) || [''])[0].replace(/<[^>]*>/g,'')||'').trim(); };
      var price = get_val('dealAmount').replace(/,/g,'');
      if (!price || isNaN(Number(price))) continue;
      items.push({
        aptNm:  get_val('aptNm'),
        price:  Number(price),
        year:   get_val('dealYear'),
        month:  get_val('dealMonth'),
        day:    get_val('dealDay'),
        floor:  get_val('floor'),
        area:   get_val('excluUseAr'),
      });
    }

    res.json({ items: items, count: items.length, raw: items.length === 0 ? body.slice(0,500) : undefined });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
