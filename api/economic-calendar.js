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

// ── Supabase REST 헬퍼 ──
const SUPA_URL = 'https://boyhppqnwtxedicxbfpz.supabase.co';
const SUPA_KEY = 'sb_publishable_Uh-YK_wDgAgQMO_CZwnyRw_SrRyQ-Tq';
const VAPID_EMAIL = 'mailto:yoonsik092609@gmail.com';

function supaRest(method, path, body) {
  return new Promise(function(resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var opts = {
      hostname: new URL(SUPA_URL).hostname,
      path: path, method: method,
      headers: { 'Content-Type':'application/json', 'apikey':SUPA_KEY, 'Authorization':'Bearer '+SUPA_KEY, 'Prefer':'resolution=merge-duplicates' },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    var req = https.request(opts, function(r) {
      var c=[]; r.on('data',function(x){c.push(x);}); r.on('end',function(){resolve({status:r.statusCode,body:Buffer.concat(c).toString('utf8')});});
    });
    req.on('error',reject); if (data) req.write(data); req.end();
  });
}
async function getSetting(key) {
  var r = await supaRest('GET','/rest/v1/settings?key=eq.'+encodeURIComponent(key)+'&select=value',null);
  try{var rows=JSON.parse(r.body);return rows&&rows[0]?rows[0].value:null;}catch(_){return null;}
}
async function setSetting(key,value){ await supaRest('POST','/rest/v1/settings',{key,value}); }

// ── VAPID 키 생성 (Node.js crypto) ──
const crypto = require('crypto');
function generateVapidKeys() {
  var {privateKey,publicKey} = crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  var pubDer=publicKey.export({type:'spki',format:'der'}), pubBytes=pubDer.slice(26);
  var privDer=privateKey.export({type:'pkcs8',format:'der'}), privBytes=privDer.slice(36,68);
  var toB64=function(buf){return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');};
  return {publicKey:toB64(pubBytes),privateKey:toB64(privBytes)};
}

// ── Web Push 전송 (web-push 라이브러리 — 직접 구현한 RFC 8291 암호화에서 버그가 반복 발견되어 검증된 라이브러리로 교체) ──
const webpush = require('web-push');

function sendPushNotif(endpoint,p256dh,auth,vapidPub,vapidPriv,payload){
  webpush.setVapidDetails(VAPID_EMAIL, vapidPub, vapidPriv);
  var subscription = { endpoint, keys: { p256dh, auth } };
  return webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 86400 })
    .then(function(result){ return { status: result.statusCode, body: result.body }; })
    .catch(function(err){ return { status: err.statusCode || 500, body: err.body || err.message }; });
}

// ── Push 액션 핸들러 ──
async function handlePushSetup(req,res){
  var pub=await getSetting('vapid_public_key');
  if(!pub){var keys=generateVapidKeys();await setSetting('vapid_public_key',keys.publicKey);await setSetting('vapid_private_key',keys.privateKey);pub=keys.publicKey;}
  res.json({publicKey:pub});
}

async function handleSubscribe(req,res){
  var body=req.body||{};
  if(req.method==='POST'){
    var {endpoint,p256dh,auth}=body;
    if(!endpoint||!p256dh||!auth) return res.status(400).json({error:'endpoint, p256dh, auth 필요'});
    var r=await supaRest('POST','/rest/v1/push_subscriptions?on_conflict=endpoint',{endpoint,p256dh,auth});
    if(r.status>=300) return res.status(500).json({ok:false,error:r.body});
    return res.json({ok:true});
  } else if(req.method==='DELETE'){
    var {endpoint}=body;
    if(!endpoint) return res.status(400).json({error:'endpoint 필요'});
    await supaRest('DELETE','/rest/v1/push_subscriptions?endpoint=eq.'+encodeURIComponent(endpoint),null);
    return res.json({ok:true});
  }
  res.status(405).json({error:'Method not allowed'});
}

async function handlePushSend(req,res){
  var secret=process.env.CRON_SECRET;
  if(secret&&req.headers['x-cron-secret']!==secret) return res.status(401).json({error:'Unauthorized'});

  var vapidPub=await getSetting('vapid_public_key'), vapidPriv=await getSetting('vapid_private_key');
  if(!vapidPub||!vapidPriv) return res.status(500).json({error:'VAPID 키 없음 — /api/economic-calendar?action=push-setup 먼저 호출'});

  var subRes=await supaRest('GET','/rest/v1/push_subscriptions?select=*',null);
  var subs=[]; try{var sp=JSON.parse(subRes.body); subs=Array.isArray(sp)?sp:[];}catch(_){}

  var sent=0, errors=0;
  async function sendToAll(payload){
    for(var sub of subs){
      try{
        var result=await sendPushNotif(sub.endpoint,sub.p256dh,sub.auth,vapidPub,vapidPriv,payload);
        if(result.status>=200&&result.status<300){sent++;}
        else if(result.status===404||result.status===410){errors++;await supaRest('DELETE','/rest/v1/push_subscriptions?endpoint=eq.'+encodeURIComponent(sub.endpoint),null);}
        else{errors++;}
      }catch(_){errors++;}
    }
  }

  // ── ① 경제 캘린더 알림 (구독자 없거나 대상 이벤트 없어도 아래 실적 체크는 계속 진행) ──
  var econEvents=0;
  try {
    var ALLOWED=['USD','KRW','JPY'], ALLOWED_IMPACT=['High','Medium'], allEvents=[];
    for(var w of ['thisweek','nextweek']){
      try{var r=await get('https://nfs.faireconomy.media/ff_calendar_'+w+'.json?timezone=Asia/Seoul');
        if(r.status===200) JSON.parse(r.body).forEach(function(e){if(ALLOWED.includes(e.currency)&&ALLOWED_IMPACT.includes(e.impact)&&e.date)allEvents.push(e);});
      }catch(_){}
    }
    var nowMs=Date.now(), toNotify=[];
    allEvents.forEach(function(ev){
      var diffM=(new Date(ev.date).getTime()-nowMs)/60000;
      if(diffM>=50&&diffM<70) toNotify.push({ev,type:'1hour'});
      else if(diffM>=1430&&diffM<1450) toNotify.push({ev,type:'1day'});
    });
    econEvents=toNotify.length;

    if (subs.length) {
      var CFLAG={USD:'🇺🇸',KRW:'🇰🇷',JPY:'🇯🇵'}, CKO={USD:'미국',KRW:'한국',JPY:'일본'};
      for(var {ev,type} of toNotify){
        var payload={title:(type==='1hour'?'⏰ 1시간 후 발표 ':'📅 내일 발표 예정 ')+(CFLAG[ev.currency]||''),
          body:(CKO[ev.currency]||ev.currency)+' · '+translateTitle(ev.title)+'\n⏱ '+(ev.time||'시간 미정')+' (KST)'+(ev.forecast?'\n📊 예측: '+ev.forecast:'')+(ev.previous?' · 이전: '+ev.previous:''),
          tag:'econ-'+ev.currency+'-'+(ev.date||'').replace(/\D/g,'').slice(0,10)+'-'+type, url:'/?page=market'};
        await sendToAll(payload);
      }
    }
  } catch(_) {}

  // ── ② 실적 발표 알림 (경제 캘린더 결과와 무관하게 항상 실행) ──
  var earningsChecked=0;
  try {
    var kstNow = new Date(Date.now() + 9*3600000);
    var kstH = kstNow.getUTCHours();
    var kstToday = kstNow.toISOString().slice(0,10);

    var ewRes = await supaRest('GET', '/rest/v1/earnings_watchlist?select=ticker,company_name&notify=eq.true', null);
    var ew = []; try { var ewp=JSON.parse(ewRes.body); ew=Array.isArray(ewp)?ewp:[]; } catch(_) {}

    if (ew.length) {
      var tMap = {}; ew.forEach(function(w) { tMap[w.ticker] = w.company_name; });
      var inList = Object.keys(tMap).join(',');
      var eeRes = await supaRest('GET', '/rest/v1/earnings_events?select=*&ticker=in.('+inList+')&order=report_date.desc', null);
      var eeAll = []; try { var eep=JSON.parse(eeRes.body); eeAll=Array.isArray(eep)?eep:[]; } catch(_) {}

      // ticker별 가장 최신(미래에 가까운) 1건만 사용
      var latestByTicker = {};
      eeAll.forEach(function(e){ if(!latestByTicker[e.ticker]) latestByTicker[e.ticker]=e; });

      // 지난 날짜이거나 데이터 없는 종목 → 다음 실적일 자동 재조회 (구독자 유무와 무관하게 항상 최신화)
      var staleTickers = Object.keys(tMap).filter(function(t){
        var e = latestByTicker[t];
        return !e || e.report_date < kstToday;
      });
      for (var st of staleTickers) {
        var fresh = await fetchNextEarningsDate(st, kstToday);
        if (fresh) {
          await storeEarningsResult(st, fresh);
          latestByTicker[st] = { ticker: st, report_date: fresh.date, report_time: earningsTimeLabel(fresh.hour), eps_estimate: null };
        }
      }

      var ee = Object.keys(latestByTicker).map(function(k){ return latestByTicker[k]; });
      earningsChecked = ee.length;

      var earningsToNotify = [];
      ee.forEach(function(e) {
        var isAMC = e.report_time && e.report_time.includes('AMC');
        var isBMO = e.report_time && e.report_time.includes('BMO');
        var kstEventDate = isAMC
          ? new Date(new Date(e.report_date+'T00:00:00Z').getTime()+86400000).toISOString().slice(0,10)
          : e.report_date;
        var kstDayBefore = new Date(new Date(kstEventDate+'T00:00:00Z').getTime()-86400000).toISOString().slice(0,10);
        // AMC: 새벽 5시 발표 → 4시(1시간 전), 전날 5시(하루 전)
        if (isAMC) {
          if (kstToday === kstEventDate && kstH === 4)  earningsToNotify.push({e, type:'1hour'});
          if (kstToday === kstDayBefore  && kstH === 5)  earningsToNotify.push({e, type:'1day'});
        // BMO: 밤 22시 발표 → 21시(1시간 전), 전날 22시(하루 전)
        } else if (isBMO) {
          if (kstToday === kstEventDate && kstH === 21) earningsToNotify.push({e, type:'1hour'});
          if (kstToday === kstDayBefore  && kstH === 22) earningsToNotify.push({e, type:'1day'});
        // 시간 미정: 당일/전날 오전 9시
        } else {
          if (kstToday === kstEventDate && kstH === 9) earningsToNotify.push({e, type:'1hour'});
          if (kstToday === kstDayBefore  && kstH === 9) earningsToNotify.push({e, type:'1day'});
        }
      });

      if (subs.length) {
        for (var {e: ev, type: notifType} of earningsToNotify) {
          var evIsAMC = ev.report_time && ev.report_time.includes('AMC');
          var companyName = tMap[ev.ticker] || ev.ticker;
          var epsTxt = ev.eps_estimate ? ' · EPS 예상 $'+ev.eps_estimate : '';
          var timeLabel = evIsAMC ? '새벽 5시경 (KST)' : '밤 10시경 (KST)';
          var title = notifType === '1hour'
            ? '⏰ 1시간 후 실적 발표! 📊'
            : '📅 내일 ' + (evIsAMC ? '새벽' : '밤') + ' 실적 발표 예정';
          var payload = {
            title,
            body: companyName+' ('+ev.ticker+')\n⏱ '+timeLabel+epsTxt,
            tag: 'earnings-'+ev.ticker+'-'+ev.report_date+'-'+notifType,
            url: '/?page=market',
          };
          await sendToAll(payload);
        }
      }
    }
  } catch(_) {}

  res.json({sent,errors,econEvents,earningsChecked,subs:subs.length});
}

// ── Finnhub 헬퍼 (직접 HTTPS — ForexFactory 헤더 오염 방지) ──
function finnhubGet(path) {
  var key = process.env.FINNHUB_KEY || '';
  var sep = path.includes('?') ? '&' : '?';
  var fullPath = '/api/v1' + path + sep + 'token=' + encodeURIComponent(key);
  return new Promise(function(resolve, reject) {
    var req2 = https.request({ hostname:'finnhub.io', path:fullPath, method:'GET',
      headers:{ 'Accept':'application/json','User-Agent':'Mozilla/5.0' }, timeout:10000,
    }, function(resp) {
      var c=[]; resp.on('data',function(x){c.push(x);}); resp.on('end',function(){ resolve({status:resp.statusCode,body:Buffer.concat(c).toString('utf8')}); });
    });
    req2.on('error',reject); req2.on('timeout',function(){req2.destroy();reject(new Error('timeout'));}); req2.end();
  });
}

// ── 실적 캘린더 핸들러 ──
async function handleEarningsList(req, res) {
  var wRes = await supaRest('GET', '/rest/v1/earnings_watchlist?select=*&order=ticker.asc', null);
  var watchlist = [];
  try {
    var parsed = JSON.parse(wRes.body);
    watchlist = Array.isArray(parsed) ? parsed : [];
    if (!Array.isArray(parsed) && parsed && parsed.message) return res.status(500).json({ error: 'DB 오류: ' + parsed.message });
  } catch(_) {}

  var today = new Date().toISOString().slice(0,10);
  var future = new Date(Date.now() + 90*86400000).toISOString().slice(0,10);
  var eRes = await supaRest('GET', '/rest/v1/earnings_events?select=*&report_date=gte.'+today+'&report_date=lte.'+future+'&order=report_date.asc', null);
  var events = []; try { var ep = JSON.parse(eRes.body); events = Array.isArray(ep) ? ep : []; } catch(_) {}

  var eventMap = {};
  events.forEach(function(e) { if (!eventMap[e.ticker]) eventMap[e.ticker] = e; });
  res.json({ items: watchlist.map(function(w) { return Object.assign({}, w, { event: eventMap[w.ticker] || null }); }) });
}

async function handleEarningsAdd(req, res) {
  var body = req.body || {};
  if (req.method === 'DELETE') {
    var ticker = (body.ticker || '').toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'ticker 필요' });
    await supaRest('DELETE', '/rest/v1/earnings_watchlist?ticker=eq.'+encodeURIComponent(ticker), null);
    await supaRest('DELETE', '/rest/v1/earnings_events?ticker=eq.'+encodeURIComponent(ticker), null);
    return res.json({ ok: true });
  }
  if (req.method === 'POST') {
    var ticker = (body.ticker || '').toUpperCase();
    if (!ticker) return res.status(400).json({ error: 'ticker 필요' });
    var market = body.market || 'US';
    var name = body.company_name || '';
    if (!name && market === 'US') {
      try {
        var pRes = await finnhubGet('/stock/profile2?symbol='+encodeURIComponent(ticker));
        if (pRes.status === 200) { var p = JSON.parse(pRes.body); name = p.name || ''; }
      } catch(_) {}
    }
    if (!name) name = ticker;
    // on_conflict=ticker 로 upsert 명시
    var insertRes = await supaRest('POST', '/rest/v1/earnings_watchlist?on_conflict=ticker', { ticker, company_name: name, market, notify: true });
    if (insertRes.status >= 300) {
      var errBody = ''; try { errBody = JSON.parse(insertRes.body).message || insertRes.body; } catch(_) { errBody = insertRes.body; }
      return res.status(500).json({ error: 'DB 저장 실패: ' + errBody });
    }
    if (market === 'KR' && body.report_date) {
      await supaRest('POST', '/rest/v1/earnings_events?on_conflict=ticker,report_date', { ticker, report_date: body.report_date, report_time: body.report_time || null, is_manual: true });
    }
    return res.json({ ok: true, company_name: name });
  }
  res.status(405).json({ error: 'Method not allowed' });
}

async function handleEarningsSearch(req, res) {
  var q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  var key = process.env.FINNHUB_KEY || '';
  if (!key) return res.status(500).json({ error: 'FINNHUB_KEY 환경변수 없음' });

  // get()의 ForexFactory 헤더를 피해 직접 요청
  var r = await new Promise(function(resolve, reject) {
    var path = '/api/v1/search?q=' + encodeURIComponent(q) + '&token=' + encodeURIComponent(key);
    var req2 = https.request({ hostname: 'finnhub.io', path: path, method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: 8000,
    }, function(resp) {
      var c = []; resp.on('data', function(x) { c.push(x); });
      resp.on('end', function() { resolve({ status: resp.statusCode, body: Buffer.concat(c).toString('utf8') }); });
    });
    req2.on('error', reject);
    req2.on('timeout', function() { req2.destroy(); reject(new Error('timeout')); });
    req2.end();
  });

  if (r.status !== 200) return res.status(502).json({ error: 'Finnhub HTTP ' + r.status + ': ' + r.body.slice(0, 200) });
  var data = JSON.parse(r.body);
  if (data.error) return res.status(403).json({ error: 'Finnhub: ' + data.error });

  var results = (data.result || [])
    .filter(function(item) {
      var sym = (item.displaySymbol || item.symbol || '');
      return !sym.includes('.') && sym.length <= 5 &&
             ['Common Stock', 'EQS', 'DR'].includes(item.type);
    })
    .slice(0, 7)
    .map(function(item) { return { ticker: item.displaySymbol || item.symbol, name: item.description }; });
  res.json({ results });
}

// Yahoo Finance로 종목별 다음 실적 날짜 조회
function getYahooEarnings(ticker) {
  return new Promise(function(resolve, reject) {
    var path = '/v10/finance/quoteSummary/' + encodeURIComponent(ticker) +
               '?modules=calendarEvents&corsDomain=finance.yahoo.com&formatted=false';
    var req2 = https.request({
      hostname: 'query1.finance.yahoo.com', path: path, method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }, timeout: 10000,
    }, function(resp) {
      var c = []; resp.on('data', function(x){c.push(x);}); resp.on('end', function(){ resolve({status:resp.statusCode,body:Buffer.concat(c).toString('utf8')}); });
    });
    req2.on('error', reject); req2.on('timeout', function(){req2.destroy();reject(new Error('Yahoo timeout'));}); req2.end();
  });
}

// 종목 하나의 다음 실적 날짜 조회 (Yahoo 1차 → Finnhub 2차 폴백)
async function fetchNextEarningsDate(ticker, today) {
  var result = null;
  var yahooDate = null;

  // 1단계: Yahoo에서 날짜 가져오기 (날짜 기준으로 신뢰도 높음)
  try {
    var yr = await getYahooEarnings(ticker);
    if (yr.status === 200) {
      var ydata = JSON.parse(yr.body);
      var yres = ydata.quoteSummary && ydata.quoteSummary.result && ydata.quoteSummary.result[0];
      if (yres && yres.calendarEvents && yres.calendarEvents.earnings) {
        var dates = yres.calendarEvents.earnings.earningsDate;
        if (dates && dates.length) {
          var raw = dates[0];
          var dateStr = (typeof raw === 'object' && raw.fmt) ? raw.fmt
                      : (typeof raw === 'object' && raw.raw) ? new Date(raw.raw*1000).toISOString().slice(0,10)
                      : null;
          if (dateStr && dateStr >= today) yahooDate = dateStr;
        }
      }
    }
  } catch(_) {}

  // 2단계: Finnhub에서 AMC/BMO 시간 정보 가져오기 (날짜는 무시하고 hour만 사용)
  var finnhubHour = null;
  try {
    var to = new Date(Date.now() + 90*86400000).toISOString().slice(0,10);
    var fr = await finnhubGet('/calendar/earnings?from='+today+'&to='+to+'&symbol='+encodeURIComponent(ticker));
    if (fr.status === 200) {
      var fdata = JSON.parse(fr.body);
      var fitems = (fdata.earningsCalendar || []).filter(function(e){ return e.symbol===ticker && e.date>=today; });
      if (fitems.length) {
        finnhubHour = fitems[0].hour || null;
        // Yahoo 날짜가 없을 때만 Finnhub 날짜 사용
        if (!yahooDate) yahooDate = fitems[0].date;
      }
    }
  } catch(_) {}

  if (yahooDate) result = { date: yahooDate, hour: finnhubHour };
  return result;
}

function earningsTimeLabel(hour) {
  return hour === 'bmo' ? '장 시작 전 (BMO)' : hour === 'amc' ? '장 마감 후 (AMC)' : null;
}

async function storeEarningsResult(ticker, result) {
  // 자동조회 기록은 종목당 최신 1건만 유지 (지난 날짜 누적 방지)
  await supaRest('DELETE', '/rest/v1/earnings_events?ticker=eq.'+encodeURIComponent(ticker)+'&is_manual=eq.false', null);
  return await supaRest('POST', '/rest/v1/earnings_events?on_conflict=ticker,report_date', {
    ticker, report_date: result.date, report_time: earningsTimeLabel(result.hour), is_manual: false,
  });
}

async function handleEarningsSync(req, res) {
  var wRes = await supaRest('GET', '/rest/v1/earnings_watchlist?select=ticker&market=eq.US', null);
  var watchlist = []; try { var wp = JSON.parse(wRes.body); watchlist = Array.isArray(wp) ? wp : []; } catch(_) {}
  if (!watchlist.length) return res.json({ synced: 0, found: 0, message: '등록된 미국 주식 없음' });

  var today = new Date().toISOString().slice(0,10);
  var synced = 0, found = 0;

  for (var w of watchlist) {
    var result = await fetchNextEarningsDate(w.ticker, today);
    if (!result) continue;
    found++;
    var r = await storeEarningsResult(w.ticker, result);
    if (r.status < 300) synced++;
  }
  res.json({ synced, found });
}

// 테스트용: 실제 알림 조건과 무관하게 구독자 전원에게 즉시 푸시 1건 발송
async function handleTestPush(req, res) {
  var vapidPub=await getSetting('vapid_public_key'), vapidPriv=await getSetting('vapid_private_key');
  if(!vapidPub||!vapidPriv) return res.status(500).json({error:'VAPID 키 없음'});

  var subRes=await supaRest('GET','/rest/v1/push_subscriptions?select=*',null);
  var subs=[]; try{var sp=JSON.parse(subRes.body); subs=Array.isArray(sp)?sp:[];}catch(_){}
  if(!subs.length) return res.json({sent:0,message:'구독자 없음'});

  var payload = {
    title: '🔔 테스트 알림',
    body: '이 알림이 보이면 푸시 시스템이 정상 작동 중이에요!',
    tag: 'test-push-'+Date.now(),
    url: '/?page=market',
  };
  var sent=0, errors=0;
  for (var sub of subs) {
    try {
      var r = await sendPushNotif(sub.endpoint, sub.p256dh, sub.auth, vapidPub, vapidPriv, payload);
      if (r.status>=200 && r.status<300) sent++;
      else errors++;
    } catch(_) { errors++; }
  }
  res.json({ sent, errors, subs: subs.length });
}

// ── 메인 라우터 ──
function getSeasonStr() {
  var now = new Date();
  var y = now.getUTCFullYear(), m = now.getUTCMonth();
  return m >= 7 ? y + '-' + (y+1) : (y-1) + '-' + y;
}

function getSportsDB(path) {
  return new Promise(function(resolve, reject) {
    var u = new URL('https://www.thesportsdb.com' + path);
    var opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, timeout: 10000 };
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

function mapLFCEvent(ev) {
  var LFC = '133602';
  var isHome = String(ev.idHomeTeam) === LFC;
  return {
    date: ev.dateEvent,
    timestamp: ev.strTimestamp || (ev.dateEvent + 'T' + (ev.strTime || '00:00:00') + 'Z'),
    opponent: isHome ? (ev.strAwayTeam || '') : (ev.strHomeTeam || ''),
    opponentBadge: isHome ? (ev.strAwayTeamBadge || '') : (ev.strHomeTeamBadge || ''),
    isHome: isHome,
    lfcScore: isHome ? ev.intHomeScore : ev.intAwayScore,
    oppScore: isHome ? ev.intAwayScore : ev.intHomeScore,
    eventId: ev.idEvent,
  };
}

async function handleLiverpool(req, res) {
  var LFC = '133602';
  var season = getSeasonStr();
  var allEvents = [];
  var seen = {};

  // 1차: 팀 시즌 전체 일정 (가장 완전한 데이터)
  try {
    var r1 = await getSportsDB('/api/v1/json/3/eventsseason.php?id=' + LFC + '&s=' + season);
    if (r1.status === 200) {
      var d1 = JSON.parse(r1.body);
      (d1.events || []).forEach(function(ev) {
        if (!seen[ev.idEvent]) { seen[ev.idEvent] = 1; allEvents.push(ev); }
      });
    }
  } catch(_) {}

  // 2차 fallback: 다음 5경기 + 최근 15경기
  if (allEvents.length < 3) {
    try {
      var r2 = await getSportsDB('/api/v1/json/3/eventsnext.php?id=' + LFC);
      if (r2.status === 200) {
        var d2 = JSON.parse(r2.body);
        (d2.events || []).forEach(function(ev) {
          if (!seen[ev.idEvent]) { seen[ev.idEvent] = 1; allEvents.push(ev); }
        });
      }
    } catch(_) {}
    try {
      var r3 = await getSportsDB('/api/v1/json/3/eventslast.php?id=' + LFC);
      if (r3.status === 200) {
        var d3 = JSON.parse(r3.body);
        (d3.results || []).forEach(function(ev) {
          if (!seen[ev.idEvent]) { seen[ev.idEvent] = 1; allEvents.push(ev); }
        });
      }
    } catch(_) {}
  }

  // EPL 경기만 필터 (idLeague === '4328')
  var eplOnly = allEvents.filter(function(ev) {
    return String(ev.idLeague) === '4328' &&
      (String(ev.idHomeTeam) === LFC || String(ev.idAwayTeam) === LFC);
  });
  // EPL 필터 후 너무 적으면 전체 허용
  if (eplOnly.length < 3) eplOnly = allEvents.filter(function(ev) {
    return String(ev.idHomeTeam) === LFC || String(ev.idAwayTeam) === LFC;
  });

  eplOnly.sort(function(a, b) { return (a.dateEvent || '').localeCompare(b.dateEvent || ''); });
  res.json({ events: eplOnly.map(mapLFCEvent), season: season, total: eplOnly.length });
}

async function handleEPLTable(req, res) {
  var season = getSeasonStr();
  var table = [];

  // 현재 시즌 시도
  try {
    var r = await getSportsDB('/api/v1/json/3/lookuptable.php?l=4328&s=' + season);
    if (r.status === 200) {
      var d = JSON.parse(r.body);
      table = d.table || [];
    }
  } catch(_) {}

  // 20팀 미만이면 이전 시즌으로 폴백
  if (table.length < 20) {
    var prevSeason = (function() {
      var p = season.split('-');
      return (Number(p[0]) - 1) + '-' + (Number(p[1]) - 1);
    })();
    try {
      var rp = await getSportsDB('/api/v1/json/3/lookuptable.php?l=4328&s=' + prevSeason);
      if (rp.status === 200) {
        var dp = JSON.parse(rp.body);
        if ((dp.table || []).length > table.length) { table = dp.table; season = prevSeason; }
      }
    } catch(_) {}
  }

  res.json({ table: table, season: season, isFallback: season !== getSeasonStr() });
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var action = req.query && req.query.action;

  try {
    if (action === 'push-setup')    return await handlePushSetup(req, res);
    if (action === 'subscribe')     return await handleSubscribe(req, res);
    if (action === 'send')          return await handlePushSend(req, res);
    if (action === 'test-push')     return await handleTestPush(req, res);
    if (action === 'earnings-list')   return await handleEarningsList(req, res);
    if (action === 'earnings-add')    return await handleEarningsAdd(req, res);
    if (action === 'earnings-sync')   return await handleEarningsSync(req, res);
    if (action === 'earnings-search') return await handleEarningsSearch(req, res);
    if (action === 'liverpool')       return await handleLiverpool(req, res);
    if (action === 'epl-table')       return await handleEPLTable(req, res);

    // 기본: 경제 캘린더 조회
    var period = req.query.period || 'thisweek';
    if (!['thisweek','nextweek'].includes(period)) period = 'thisweek';
    var url = 'https://nfs.faireconomy.media/ff_calendar_' + period + '.json?timezone=Asia/Seoul';
    var r = await get(url);
    if (r.status !== 200) {
      // nextweek 데이터는 주중에만 제공됨 — 없을 때 빈 배열 반환
      if (period === 'nextweek') return res.json({ events: [], period: period, notice: '다음주 일정은 아직 공개되지 않았어요' });
      return res.status(502).json({ error: 'ForexFactory API 오류: ' + r.status });
    }
    var events = JSON.parse(r.body);
    var ALLOWED_CURRENCIES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'KRW'];
    var result = events
      .filter(function(e) { return ALLOWED_CURRENCIES.includes(e.currency); })
      .map(function(e) {
        var dt = new Date(e.date);
        var koTitle = translateTitle(e.title);
        return {
          date:e.date, dateStr:dt.toLocaleDateString('ko-KR',{month:'short',day:'numeric',weekday:'short'}),
          timeStr:e.time||'시간 미정', title:e.title, titleKo:koTitle,
          currency:e.currency, countryKo:COUNTRY_KO[e.currency]||e.currency,
          impact:e.impact, impactKo:IMPACT_KO[e.impact]||e.impact, impactOrd:IMPACT_ORDER[e.impact]||0,
          actual:e.actual||null, forecast:e.forecast||null, previous:e.previous||null,
        };
      });
    res.json({ events: result, period: period });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
