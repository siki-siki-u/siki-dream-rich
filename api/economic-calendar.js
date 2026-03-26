const https = require('https');

// 경제 지표 한국어 번역 맵
var EVENT_KO = {
  // 미국 고용
  'Non-Farm Employment Change': '비농업 고용자수',
  'Non-Farm Payrolls': '비농업 고용자수',
  'ADP Non-Farm Employment Change': 'ADP 비농업 고용자수',
  'Unemployment Rate': '실업률',
  'Initial Jobless Claims': '신규 실업수당 청구건수',
  'Continued Jobless Claims': '계속 실업수당 청구건수',
  'Average Hourly Earnings m/m': '평균 시간당 임금 (월)',
  'Average Hourly Earnings y/y': '평균 시간당 임금 (연)',
  'Employment Cost Index q/q': '고용비용지수 (분기)',
  'JOLTS Job Openings': 'JOLTS 구인건수',
  'Challenger Job Cuts y/y': '챌린저 감원 발표',
  // 미국 물가
  'CPI m/m': '소비자물가지수 (월)',
  'CPI y/y': '소비자물가지수 (연)',
  'Core CPI m/m': '근원 소비자물가지수 (월)',
  'Core CPI y/y': '근원 소비자물가지수 (연)',
  'PPI m/m': '생산자물가지수 (월)',
  'PPI y/y': '생산자물가지수 (연)',
  'Core PPI m/m': '근원 생산자물가지수 (월)',
  'PCE Price Index m/m': 'PCE 물가지수 (월)',
  'Core PCE Price Index m/m': '근원 PCE 물가지수 (월)',
  'Import Prices m/m': '수입물가지수 (월)',
  'Export Prices m/m': '수출물가지수 (월)',
  // 미국 연준
  'Federal Funds Rate': '연준 기준금리',
  'Fed Interest Rate Decision': '연준 기준금리 결정',
  'FOMC Statement': 'FOMC 성명서',
  'FOMC Meeting Minutes': 'FOMC 의사록',
  'FOMC Press Conference': 'FOMC 기자회견',
  'FOMC Economic Projections': 'FOMC 경제전망',
  'Beige Book': '베이지북',
  // 미국 GDP·성장
  'GDP q/q': 'GDP 성장률 (분기)',
  'Prelim GDP q/q': 'GDP 성장률 예비치 (분기)',
  'Final GDP q/q': 'GDP 성장률 최종치 (분기)',
  'GDP Price Index q/q': 'GDP 물가지수 (분기)',
  // 미국 소비·소매
  'Retail Sales m/m': '소매판매 (월)',
  'Core Retail Sales m/m': '근원 소매판매 (월)',
  'CB Consumer Confidence': '소비자신뢰지수',
  'Michigan Consumer Sentiment': '미시간 소비자심리지수',
  'Prelim UoM Consumer Sentiment': '미시간 소비자심리지수 예비치',
  'Personal Spending m/m': '개인소비지출 (월)',
  'Personal Income m/m': '개인소득 (월)',
  // 미국 제조·산업
  'ISM Manufacturing PMI': 'ISM 제조업 PMI',
  'ISM Non-Manufacturing PMI': 'ISM 서비스업 PMI',
  'ISM Services PMI': 'ISM 서비스업 PMI',
  'Flash Manufacturing PMI': '제조업 PMI 속보치',
  'Flash Services PMI': '서비스업 PMI 속보치',
  'Empire State Manufacturing Index': '뉴욕 제조업지수',
  'Philly Fed Manufacturing Index': '필라델피아 제조업지수',
  'Chicago PMI': '시카고 PMI',
  'Industrial Production m/m': '산업생산 (월)',
  'Capacity Utilization Rate': '설비 가동률',
  'Factory Orders m/m': '공장 수주 (월)',
  'Durable Goods Orders m/m': '내구재 주문 (월)',
  'Core Durable Goods Orders m/m': '근원 내구재 주문 (월)',
  // 미국 주택
  'Building Permits': '건축허가건수',
  'Housing Starts': '주택착공건수',
  'Existing Home Sales': '기존주택 판매',
  'New Home Sales': '신규주택 판매',
  'Pending Home Sales m/m': '잠정주택 판매 (월)',
  'S&P/CS Composite-20 HPI m/m': 'S&P 케이스쉴러 주택가격지수',
  // 미국 무역
  'Trade Balance': '무역수지',
  'Goods Trade Balance': '상품 무역수지',
  'Current Account': '경상수지',
  // 유로존
  'ECB Interest Rate Decision': 'ECB 기준금리 결정',
  'ECB Press Conference': 'ECB 기자회견',
  'ECB Monetary Policy Statement': 'ECB 통화정책 성명서',
  'German CPI m/m': '독일 소비자물가지수 (월)',
  'German CPI y/y': '독일 소비자물가지수 (연)',
  'German GDP q/q': '독일 GDP (분기)',
  'German Ifo Business Climate': '독일 IFO 기업환경지수',
  'German Industrial Production m/m': '독일 산업생산 (월)',
  'German Unemployment Change': '독일 실업자수 변화',
  'German Unemployment Rate': '독일 실업률',
  'Flash German Manufacturing PMI': '독일 제조업 PMI 속보치',
  'Flash German Services PMI': '독일 서비스업 PMI 속보치',
  'French CPI m/m': '프랑스 소비자물가지수 (월)',
  'French GDP q/q': '프랑스 GDP (분기)',
  'Euro Area CPI y/y': '유로존 소비자물가지수 (연)',
  'Euro Area Core CPI y/y': '유로존 근원 소비자물가지수 (연)',
  'Euro Area GDP q/q': '유로존 GDP (분기)',
  'Euro Area Unemployment Rate': '유로존 실업률',
  'Euro Area Trade Balance': '유로존 무역수지',
  'Flash Euro Area Manufacturing PMI': '유로존 제조업 PMI 속보치',
  'Flash Euro Area Services PMI': '유로존 서비스업 PMI 속보치',
  // 영국
  'BOE Interest Rate Decision': '영국 기준금리 결정',
  'UK CPI y/y': '영국 소비자물가지수 (연)',
  'UK GDP q/q': '영국 GDP (분기)',
  'UK Unemployment Rate': '영국 실업률',
  'UK Retail Sales m/m': '영국 소매판매 (월)',
  'UK Manufacturing PMI': '영국 제조업 PMI',
  'UK Services PMI': '영국 서비스업 PMI',
  // 일본
  'BOJ Interest Rate Decision': '일본 기준금리 결정',
  'BOJ Monetary Policy Statement': '일본은행 통화정책 성명서',
  'BOJ Press Conference': '일본은행 기자회견',
  'Japanese CPI y/y': '일본 소비자물가지수 (연)',
  'Japanese GDP q/q': '일본 GDP (분기)',
  'Japanese Trade Balance': '일본 무역수지',
  'Japanese Unemployment Rate': '일본 실업률',
  'Tankan Manufacturing Index': '일본 단칸 제조업지수',
  'Tankan Non-Manufacturing Index': '일본 단칸 서비스업지수',
  // 중국
  'Chinese CPI y/y': '중국 소비자물가지수 (연)',
  'Chinese PPI y/y': '중국 생산자물가지수 (연)',
  'Chinese GDP q/q': '중국 GDP (분기)',
  'Chinese Manufacturing PMI': '중국 제조업 PMI',
  'Chinese Non-Manufacturing PMI': '중국 서비스업 PMI',
  'Caixin Manufacturing PMI': '차이신 제조업 PMI',
  'Caixin Services PMI': '차이신 서비스업 PMI',
  'Chinese Trade Balance': '중국 무역수지',
  'Chinese Retail Sales y/y': '중국 소매판매 (연)',
  'Chinese Industrial Production y/y': '중국 산업생산 (연)',
  // 한국
  'BOK Rate Decision': '한국 기준금리 결정',
  'Korean CPI y/y': '한국 소비자물가지수 (연)',
  'Korean GDP q/q': '한국 GDP (분기)',
  'Korean Trade Balance': '한국 무역수지',
  'Korean Unemployment Rate': '한국 실업률',
};

var COUNTRY_KO = {
  'USD': '🇺🇸 미국',
  'EUR': '🇪🇺 유로존',
  'JPY': '🇯🇵 일본',
  'GBP': '🇬🇧 영국',
  'CNY': '🇨🇳 중국',
  'KRW': '🇰🇷 한국',
  'CAD': '🇨🇦 캐나다',
  'AUD': '🇦🇺 호주',
  'CHF': '🇨🇭 스위스',
};

var IMPACT_KO = { 'High': '🔴 높음', 'Medium': '🟡 중간', 'Low': '⚪ 낮음', 'Holiday': '📅 휴장' };
var IMPACT_ORDER = { 'High': 3, 'Medium': 2, 'Low': 1, 'Holiday': 0 };

function translateTitle(title) {
  if (!title) return title;
  var direct = EVENT_KO[title.trim()];
  if (direct) return direct;
  // partial match
  for (var key in EVENT_KO) {
    if (title.toLowerCase().includes(key.toLowerCase())) {
      return EVENT_KO[key];
    }
  }
  return title;
}

function get(url) {
  return new Promise(function(resolve, reject) {
    var u = new URL(url);
    var opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json',
        'Referer': 'https://www.forexfactory.com/',
      },
      timeout: 10000,
    };
    var r = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    r.on('error', reject);
    r.on('timeout', function() { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var period = (req.query && req.query.period) || 'thisweek';
  var validPeriods = ['thisweek', 'nextweek'];
  if (!validPeriods.includes(period)) period = 'thisweek';

  try {
    var url = 'https://nfs.faireconomy.media/ff_calendar_' + period + '.json?timezone=Asia/Seoul';
    var r = await get(url);
    if (r.status !== 200) return res.status(502).json({ error: 'ForexFactory API 오류: ' + r.status });

    var events = JSON.parse(r.body);

    var ALLOWED_CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'KRW'];

    var result = events
      .filter(function(e) { return ALLOWED_CURRENCIES.includes(e.currency); })
      .map(function(e) {
        var dt = new Date(e.date);
        var koTitle = translateTitle(e.title);
        return {
          date:      e.date,
          dateStr:   dt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short' }),
          timeStr:   e.time || '시간 미정',
          title:     e.title,
          titleKo:   koTitle,
          currency:  e.currency,
          countryKo: COUNTRY_KO[e.currency] || e.currency,
          impact:    e.impact,
          impactKo:  IMPACT_KO[e.impact] || e.impact,
          impactOrd: IMPACT_ORDER[e.impact] || 0,
          actual:    e.actual || null,
          forecast:  e.forecast || null,
          previous:  e.previous || null,
        };
      });

    res.json({ events: result, period: period });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
