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
  var image  = body.image;  // base64
  var mediaType = body.mediaType || 'image/jpeg';

  // Claude는 jpeg/png/gif/webp만 지원 - 그 외는 jpeg로 취급
  var supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!supportedTypes.includes(mediaType)) mediaType = 'image/jpeg';

  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 서버에 설정되지 않았습니다. Vercel 환경변수를 확인하세요.' });
  if (!image)  return res.status(400).json({ error: '이미지 누락 (body: ' + JSON.stringify(Object.keys(body)) + ')' });

  var isYujin = person === 'yujin';

  var promptYujin = `이 투자계좌 스크린샷을 보고 유진의 자산 정보를 정확히 읽어서 아래 JSON 형식으로만 응답해줘. 다른 말은 절대 하지 말고 JSON만.

각 필드 설명 (화면에 보이는 숫자를 그대로 읽어):
- "toss": 토스증권 앱의 총 평가금액. 국내주식+해외주식+ETF 모두 포함. 화면에 "총 평가금액", "보유자산", "내 주식" 등으로 표시됨.
- "isa": ISA계좌(개인종합자산관리계좌) 평가금액
- "gold": 금 계좌 또는 금 투자 금액
- "coin_u": 암호화폐(코인) 평가금액. 비트코인/이더리움/솔라나 등 가상자산만. 주식은 절대 여기 넣지 말것.
- "fund": 펀드 또는 투자신탁 평가금액
- "cheongyak": 주택청약 납입 총액
- "savings_u": 적금 잔액
- "stock_u": 토스 외 다른 증권사 개인주식 계좌 금액 (키움/미래에셋/신한 등)
- "summary": 화면에서 읽은 총액과 수익률을 그대로 요약 (예: "총 평가금액 1,234만원, 수익률 +2.1%")

중요: 해외주식(미국주식 포함)은 coin이 아니라 toss 또는 stock_u에 넣을것. 없는 항목은 0. 금액은 원화 숫자(쉼표없이).
{
  "toss": 숫자,
  "isa": 숫자,
  "gold": 숫자,
  "coin_u": 숫자,
  "fund": 숫자,
  "cheongyak": 숫자,
  "savings_u": 숫자,
  "stock_u": 숫자,
  "summary": "문자열"
}`;

  var promptYoonsik = `이 투자계좌 스크린샷을 보고 윤식의 자산 정보를 정확히 읽어서 아래 JSON 형식으로만 응답해줘. 다른 말은 절대 하지 말고 JSON만.

각 필드 설명 (화면에 보이는 숫자를 그대로 읽어):
- "coin_y": 암호화폐(코인) 평가금액. 비트코인/이더리움/솔라나 등 가상자산만. 주식은 절대 여기 넣지 말것.
- "savings_y": 적금 잔액
- "ret_y": 퇴직연금(IRP 포함) 금액
- "summary": 화면에서 읽은 총액을 그대로 요약

중요: 해외주식(미국주식 포함)은 coin이 아님. 없는 항목은 0. 금액은 원화 숫자(쉼표없이).
{
  "coin_y": 숫자,
  "savings_y": 숫자,
  "ret_y": 숫자,
  "summary": "문자열"
}`;

  try {
    // 1단계: 숫자 추출
    var r1 = await post(apiKey, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: isYujin ? promptYujin : promptYoonsik },
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

    // 2단계: 인사이트
    var rows = isYujin
      ? [['토스증권', parsed.toss], ['ISA계좌', parsed.isa], ['금계좌', parsed.gold],
         ['코인', parsed.coin_u], ['펀드', parsed.fund], ['주택청약', parsed.cheongyak],
         ['적금', parsed.savings_u], ['개인주식', parsed.stock_u]]
      : [['코인', parsed.coin_y], ['적금', parsed.savings_y], ['퇴직연금', parsed.ret_y]];

    var insightPrompt = '아래는 ' + (isYujin ? '유진' : '윤식') + '의 투자 포트폴리오야:\n'
      + rows.filter(function(r) { return r[1] > 0; }).map(function(r) { return r[0] + ': ' + Number(r[1]).toLocaleString() + '원'; }).join('\n')
      + '\n\n이 포트폴리오에 대해 아래 형식으로 한국어로 간결하게 분석해줘:\n'
      + '📊 포트폴리오 구성: (자산 분산 평가, 1줄)\n'
      + '💡 긍정적인 점: (1~2줄)\n'
      + '⚠️ 개선 제안: (1~2줄)\n'
      + '🎯 다음 단계: (구체적 행동 제안, 1줄)\n'
      + '투자 권유가 아닌 참고 의견으로.';

    var r2 = await post(apiKey, {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      messages: [{ role: 'user', content: insightPrompt }],
    });

    var insight = '';
    if (r2.status === 200) {
      var d2 = JSON.parse(r2.body);
      insight = d2.content?.[0]?.text || '';
    }

    res.json({ parsed: parsed, insight: insight, rows: rows.filter(function(r) { return r[1] > 0; }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
