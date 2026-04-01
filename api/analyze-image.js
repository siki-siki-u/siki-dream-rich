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
- 기타 → category: "etc"
- total은 화면에 표시된 총 평가금액. 없으면 items 합산값.
- summary는 화면의 핵심 정보 1줄 (총액, 수익률 등 그대로 인용)

{
  "items": [
    {"name": "항목명 (앱/계좌명 포함)", "value": 숫자, "category": "investment|crypto|savings|pension|fund|etc"},
    ...
  ],
  "total": 숫자,
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

    // total 보정: items 합산이 더 크면 합산 사용
    var itemsSum = (parsed.items || []).reduce(function(s, i) { return s + (i.value || 0); }, 0);
    if (!parsed.total || parsed.total < itemsSum) parsed.total = itemsSum;

    var activeItems = (parsed.items || []).filter(function(i) { return i.value > 0; });
    var rows = activeItems.map(function(i) { return [i.name, i.value]; });

    if (!activeItems.length) {
      return res.json({ parsed: parsed, insight: '', rows: [], summary: parsed.summary || '항목을 읽지 못했어요' });
    }

    // 인사이트 생성
    var insightPrompt = '아래는 ' + (person === 'yujin' ? '유진' : '윤식') + '의 금융 자산 현황이야:\n'
      + activeItems.map(function(i) { return i.name + ': ' + Number(i.value).toLocaleString() + '원 (' + i.category + ')'; }).join('\n')
      + '\n총액: ' + Number(parsed.total).toLocaleString() + '원'
      + '\n\n아래 형식으로 한국어로 간결하게 분석해줘:\n'
      + '📊 구성: (자산 분산 1줄)\n'
      + '💡 긍정적인 점: (1줄)\n'
      + '⚠️ 개선 제안: (1줄)\n'
      + '🎯 다음 단계: (1줄)\n'
      + '투자 권유 아닌 참고 의견으로.';

    var r2 = await post(apiKey, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: insightPrompt }],
    });

    var insight = '';
    if (r2.status === 200) {
      var d2 = JSON.parse(r2.body);
      insight = d2.content?.[0]?.text || '';
    }

    res.json({ parsed: parsed, insight: insight, rows: rows, summary: parsed.summary });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
