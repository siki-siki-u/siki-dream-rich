const https = require('https');

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();

  function get(url) {
    return new Promise(function(resolve, reject) {
      var opts = new URL(url);
      var reqOpts = {
        hostname: opts.hostname,
        path: opts.pathname + opts.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://edition.cnn.com/markets/fear-and-greed',
        },
        timeout: 8000,
      };
      var r = https.request(reqOpts, function(response) {
        var chunks = [];
        response.on('data', function(c) { chunks.push(c); });
        response.on('end', function() { resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
      });
      r.on('error', reject);
      r.on('timeout', function() { r.destroy(); reject(new Error('timeout')); });
      r.end();
    });
  }

  try {
    var r = await get('https://production.dataviz.cnn.io/index/fearandgreed/graphdata');
    if (r.status !== 200) return res.status(502).json({ error: 'CNN API 오류: ' + r.status });

    var data = JSON.parse(r.body);
    var fg = data.fear_and_greed;

    // rating 한국어 변환
    var ratingMap = {
      'Extreme Fear':  '극공포',
      'Fear':          '공포',
      'Neutral':       '중립',
      'Greed':         '탐욕',
      'Extreme Greed': '극탐욕',
    };

    res.json({
      score:      Math.round(fg.score),
      rating:     fg.rating,
      ratingKo:   ratingMap[fg.rating] || fg.rating,
      timestamp:  fg.timestamp,
      previous_1_week:  data.fear_and_greed_historical?.previous_1_week?.score  ?? null,
      previous_1_month: data.fear_and_greed_historical?.previous_1_month?.score ?? null,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
