// 아파트 실거래가 프록시 (MOLIT API) — Node.js 서버리스
const https = require('https');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { lawdCd, ym } = req.query || {};
  const key = process.env.MOLIT_API_KEY || process.env.seoul_apt || '';

  if (!lawdCd || !ym) return res.status(400).json({ error: 'lawdCd, ym 파라미터 필요' });
  if (!key)           return res.status(500).json({ error: 'MOLIT_API_KEY 환경변수 없음' });

  const apiUrl =
    'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev' +
    '?serviceKey=' + encodeURIComponent(key) +
    '&LAWD_CD=' + lawdCd +
    '&DEAL_YMD=' + ym +
    '&numOfRows=100&pageNo=1';

  try {
    const text = await new Promise(function(resolve, reject) {
      var u = new URL(apiUrl);
      var opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 12000 };
      var r = https.request(opts, function(upstream) {
        var chunks = [];
        upstream.on('data', function(c) { chunks.push(c); });
        upstream.on('end',  function()  { resolve(Buffer.concat(chunks).toString('utf8')); });
      });
      r.on('error', reject);
      r.on('timeout', function() { r.destroy(); reject(new Error('timeout')); });
      r.end();
    });

    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const e  = m[1];
      const gv = function(tag) {
        const match = e.match(new RegExp('<' + tag + '>[\\s\\S]*?<\\/' + tag + '>'));
        return match ? match[0].replace(/<[^>]*>/g, '').trim() : '';
      };
      const price = gv('dealAmount').replace(/,/g, '');
      if (!price || isNaN(Number(price))) continue;
      const yr = gv('dealYear');
      const mo = gv('dealMonth').padStart(2, '0');
      const dy = gv('dealDay').padStart(2, '0');
      items.push({
        aptNm: gv('aptNm'),
        price: Number(price),
        year:  yr,
        month: gv('dealMonth'),
        day:   gv('dealDay'),
        date:  yr + '-' + mo + '-' + dy,
        floor: gv('floor'),
        area:  gv('excluUseAr'),
        umdNm: gv('umdNm'),
      });
    }

    res.json({ items, count: items.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
