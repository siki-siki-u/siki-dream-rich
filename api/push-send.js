// GitHub Actions 크론이 매 시간 호출 → 경제 지표 발표 1일 전 / 1시간 전 Push 알림 발송
const webpush = require('web-push');
const https   = require('https');

const SUPA_URL = 'https://boyhppqnwtxedicxbfpz.supabase.co';
const SUPA_KEY = 'sb_publishable_Uh-YK_wDgAgQMO_CZwnyRw_SrRyQ-Tq';

const COUNTRY_FLAG = { USD: '🇺🇸', KRW: '🇰🇷', JPY: '🇯🇵', EUR: '🇪🇺', GBP: '🇬🇧', CNY: '🇨🇳' };
const COUNTRY_KO   = { USD: '미국', KRW: '한국', JPY: '일본', EUR: '유로존', GBP: '영국', CNY: '중국' };

var EVENT_KO = {
  'Fed Interest Rate Decision': '연준 기준금리 결정',
  'Federal Funds Rate': '연준 기준금리',
  'FOMC Statement': 'FOMC 성명서',
  'FOMC Press Conference': 'FOMC 기자회견',
  'CPI m/m': '소비자물가지수 (월)',
  'CPI y/y': '소비자물가지수 (연)',
  'Core CPI m/m': '근원 소비자물가지수 (월)',
  'Non-Farm Employment Change': '비농업 고용자수',
  'Non-Farm Payrolls': '비농업 고용자수',
  'Unemployment Rate': '실업률',
  'PPI m/m': '생산자물가지수 (월)',
  'PCE Price Index m/m': 'PCE 물가지수 (월)',
  'Core PCE Price Index m/m': '근원 PCE 물가지수 (월)',
  'GDP q/q': 'GDP 성장률 (분기)',
  'BOJ Interest Rate Decision': '일본 기준금리 결정',
  'BOK Rate Decision': '한국 기준금리 결정',
  'ECB Interest Rate Decision': 'ECB 기준금리 결정',
  'Japanese CPI y/y': '일본 소비자물가지수',
  'Korean CPI y/y': '한국 소비자물가지수',
};

function translateEvent(title) {
  if (!title) return title;
  var direct = EVENT_KO[title.trim()];
  if (direct) return direct;
  for (var k in EVENT_KO) {
    if (title.toLowerCase().includes(k.toLowerCase())) return EVENT_KO[k];
  }
  return title;
}

function httpsGet(url) {
  return new Promise(function(resolve, reject) {
    var u    = new URL(url);
    var opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.forexfactory.com/' },
      timeout: 12000,
    };
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end',  function()  { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    req.on('timeout', function() { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function supaRest(method, path, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: new URL(SUPA_URL).hostname,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPA_KEY,
        'Authorization': 'Bearer ' + SUPA_KEY,
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    var req = https.request(opts, function(res) {
      var chunks = [];
      res.on('data', function(c) { chunks.push(c); });
      res.on('end',  function()  { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getSetting(key) {
  var r = await supaRest('GET', '/rest/v1/settings?key=eq.' + encodeURIComponent(key) + '&select=value', null);
  try { var rows = JSON.parse(r.body); return rows && rows[0] ? rows[0].value : null; } catch(_) { return null; }
}

async function deleteSubscription(endpoint) {
  try {
    await supaRest('DELETE', '/rest/v1/push_subscriptions?endpoint=eq.' + encodeURIComponent(endpoint), null);
  } catch(_) {}
}

module.exports = async function(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // CRON_SECRET으로 인증 (설정된 경우)
  var secret = process.env.CRON_SECRET;
  if (secret && req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // ① VAPID 키 로드
    var vapidPub  = await getSetting('vapid_public_key');
    var vapidPriv = await getSetting('vapid_private_key');
    if (!vapidPub || !vapidPriv) return res.status(500).json({ error: 'VAPID 키 없음 — /api/push-setup 먼저 호출하세요' });

    webpush.setVapidDetails('mailto:yoonsik092609@gmail.com', vapidPub, vapidPriv);

    // ② ForexFactory 이번 주 + 다음 주 이벤트 수집
    var ALLOWED = ['USD', 'KRW', 'JPY'];
    var ALLOWED_IMPACT = ['High', 'Medium'];
    var allEvents = [];

    for (var w of ['thisweek', 'nextweek']) {
      try {
        var r = await httpsGet('https://nfs.faireconomy.media/ff_calendar_' + w + '.json?timezone=Asia/Seoul');
        if (r.status !== 200) continue;
        var items = JSON.parse(r.body);
        items.forEach(function(e) {
          if (ALLOWED.includes(e.currency) && ALLOWED_IMPACT.includes(e.impact) && e.date) {
            allEvents.push(e);
          }
        });
      } catch(_) {}
    }

    if (!allEvents.length) return res.json({ sent: 0, message: '이벤트 없음' });

    // ③ 알림 대상 필터 (현재 시각 기준)
    var nowMs = Date.now();
    var toNotify = [];

    allEvents.forEach(function(ev) {
      var evMs  = new Date(ev.date).getTime();
      var diffM = (evMs - nowMs) / 60000; // 분 단위

      // 1시간 전: 50~70분 ahead
      if (diffM >= 50 && diffM < 70) {
        toNotify.push({ ev: ev, type: '1hour' });
      }
      // 1일 전: 23h50m~24h10m ahead
      else if (diffM >= 1430 && diffM < 1450) {
        toNotify.push({ ev: ev, type: '1day' });
      }
    });

    if (!toNotify.length) return res.json({ sent: 0, message: '알림 대상 없음' });

    // ④ 구독자 목록 로드
    var subRes = await supaRest('GET', '/rest/v1/push_subscriptions?select=*', null);
    var subs   = [];
    try { subs = JSON.parse(subRes.body) || []; } catch(_) {}

    if (!subs.length) return res.json({ sent: 0, message: '구독자 없음' });

    // ⑤ 알림 발송
    var sent = 0, errors = 0;

    for (var { ev, type } of toNotify) {
      var flag    = COUNTRY_FLAG[ev.currency] || '';
      var country = COUNTRY_KO[ev.currency]  || ev.currency;
      var titleKo = translateEvent(ev.title);
      var timeStr = ev.time || '시간 미정';

      var pushTitle = type === '1hour'
        ? ('⏰ 1시간 후 발표 ' + flag)
        : ('📅 내일 발표 예정 ' + flag);

      var pushBody = country + ' · ' + titleKo + '\n'
        + '⏱ 발표 시간: ' + timeStr + ' (KST)'
        + (ev.forecast ? '\n📊 예측: ' + ev.forecast : '')
        + (ev.previous ? ' · 이전: ' + ev.previous : '');

      var payload = JSON.stringify({
        title: pushTitle,
        body:  pushBody,
        tag:   'econ-' + ev.currency + '-' + (ev.date || '').replace(/[^0-9]/g, '').slice(0, 10) + '-' + type,
        url:   '/?page=market',
      });

      for (var sub of subs) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sent++;
        } catch(e) {
          errors++;
          // 만료된 구독 자동 삭제
          if (e.statusCode === 404 || e.statusCode === 410) {
            await deleteSubscription(sub.endpoint);
          }
        }
      }
    }

    res.json({ sent, errors, events: toNotify.length, subs: subs.length });

  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
