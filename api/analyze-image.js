const https = require('https');

function post(apiKey, body) {
  return new Promise(function(resolve, reject) {
    var data = JSON.stringify(body);
    var opts = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.setTimeout(30000, function() { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  var body = req.body || {};
  var apiKey = process.env.ANTHROPIC_API_KEY;
  var person = body.person || 'yujin';
  var image  = body.image;
  var mediaType = body.mediaType || 'image/jpeg';

  var supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!supportedTypes.includes(mediaType)) mediaType = 'image/jpeg';

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다.' });
  if (!image)  return res.status(400).json({ error: '이미지 누락' });

  var prompt = `이 금융 앱 스크린샷에서 보이는 모든 자산/투자 항목을 읽어서 JSON으로만 응답해줘. 다른 말은 절대 하지 말고 JSON만.

규칙:
- 화면에 보이는 금액을 정확하게 읽을 것 (원화 기준, 숫자만, 쉼표 없이)
- 해외주식/미국주식 포함 모든 주식·ETF → category: "investment"
- 암호화폐(비트코인/이더리움 등) → category: "crypto"
- 적금/예금/CMA → category: "savings"
- 연금/IRP/퇴직연금 → category: "pension"
- 펀드/신탁 → category: "fund"
- 금/골드/금현물/금99.99/Gold → category: "gold"
- 기타 → category: "etc"
- 각 항목의 profit: 해당 항목 옆에 표시된 손익금액 (빨간/파란/초록 숫자, +면 양수 -면 음수, 없으면 null)
- 각 항목의 profit_rate: 해당 항목의 수익률 % 숫자 (없으면 null)
- total: 화면의 총 평가금액 (없으면 items value 합산)
- principal: 화면에 원금/투자금액/매수금액이 명시된 경우만 (없으면 0)
- profit: 전체 평가손익 금액 (없으면 items profit 합산 또는 0)
- profit_rate: 전체 수익률 % (없으면 null)
- summary: 총 평가금액·손익·수익률 핵심 1줄

{
  "items": [
    {"name": "항목명", "value": 숫자, "category": "investment|crypto|savings|pension|fund|etc", "profit": 숫자또는null, "profit_rate": 숫자또는null},
    ...
  ],
  "total": 숫자,
  "principal": 숫자,
  "profit": 숫자,
  "profit_rate": 숫자또는null,
  "summary": "문자열"
}`;

  try {
    var r1 = await post(apiKey, {
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: prompt },
        ],
      }],
    });

    if (r1.status !== 200) {
      var errBody = {};
      try { errBody = JSON.parse(r1.body); } catch(e) {}
      var detail = errBody.error?.message || r1.body.slice(0, 300);
      var isCredit = /credit|billing|balance|payment/i.test(detail);
      return res.status(500).json({ error: 'Claude API 오류: ' + r1.status, detail: detail, errorCode: isCredit ? 'credit_low' : undefined });
    }

    var d1 = JSON.parse(r1.body);
    var text1 = d1.content?.[0]?.text || '';
    var parsed = JSON.parse(text1.replace(/```json|```/g, '').trim());
    parsed._person = person;

    // total 보정
    var itemsSum = (parsed.items || []).reduce(function(s, i) { return s + (i.value || 0); }, 0);
    if (!parsed.total || parsed.total < itemsSum) parsed.total = itemsSum;

    // profit 보정: items의 profit 합산
    var itemsProfitSum = (parsed.items || []).reduce(function(s, i) { return s + (i.profit || 0); }, 0);
    if (!parsed.profit && itemsProfitSum !== 0) parsed.profit = itemsProfitSum;
    // principal 보정: total - profit 역산
    if (!parsed.principal && parsed.total > 0 && parsed.profit) {
      parsed.principal = parsed.total - parsed.profit;
    }
    if (parsed.principal > 0 && parsed.profit && !parsed.profit_rate) {
      parsed.profit_rate = Math.round(parsed.profit / parsed.principal * 1000) / 10;
    }

    var activeItems = (parsed.items || []).filter(function(i) { return i.value > 0; });
    var rows = activeItems.map(function(i) { return [i.name, i.value]; });

    res.json({ parsed: parsed, rows: rows, summary: parsed.summary });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
