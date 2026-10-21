// ── 텔레그램 알림 봇 엔진 ──
// 봇 설정 페이지에서 저장한 값(bot_alert_settings / bot_watch_companies / bot_brief_items)을 기준으로
// Supabase pg_cron이 1분마다 호출하는 tick에서 공시·실적·기준금리·아침 브리핑을 텔레그램으로 보낸다.
// 공용 헬퍼(supaRest, DART/Yahoo 요청 등)는 api/economic-calendar.js에서 주입받는다 (Vercel 무료 플랜 함수 12개 제한).

var https = require('https');

var SEC_UA = 'siki-dream-rich/1.0 (+https://siki-dream-rich.vercel.app)';
var BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
var DOW = ['일','월','화','수','목','금','토'];

var RATE_RESULT_VARS = ['결정','금리','변동폭','이전금리','추세','마지막변경','제목','링크'];
var RATE_PREVIEW_VARS = ['회의일','D데이','현재금리','추세','마지막변경'];

// 알림 종류별 메타 (이름·템플릿 기본값·변수·기본 시점). 봇 설정 페이지도 bot-meta로 받아서 그린다
var META = {
  disclosure: {
    name: '관심 기업 공시', icon: '📢', desc: '관심 기업에 새 공시가 올라오면 알려줘요 (국내 DART · 미국 SEC)',
    templates: { main: { label: '공시 알림', vars: ['회사명','티커','시장','분류','공시명','시각','링크'],
      def: '📢 **{회사명}** ({티커}) · {분류}\n{공시명}\n🕒 {시각}\n{링크}' } },
    timing: { mode: 'realtime', digest_hour: 18 },
    options: { categories: ['earnings','major','ownership','other'] },
  },
  earnings_result: {
    name: '실적 발표 결과', icon: '📊', desc: '관심 기업 실적이 나오면 작년 대비·컨센서스 대비로 정리해줘요',
    templates: { main: { label: '실적 결과',
      vars: ['회사명','티커','분기','분기약칭','출처','링크',
        '매출액','매출_YoY','매출_QoQ','매출_컨센서스','매출_컨센대비','매출_컨센판정',
        '영업이익','영업이익_YoY','영업이익_QoQ','영업이익_컨센서스','영업이익_컨센대비','영업이익_컨센판정',
        '영업이익률','영업이익률_YoY','영업이익률_QoQ','영업이익률_컨센서스','영업이익률_컨센대비','영업이익률_컨센판정',
        '순이익','순이익_YoY','순이익_QoQ','EPS','EPS_예상','EPS_컨센대비','EPS_컨센판정','기타사항','AI_한줄평','AI_점수'],
      def: '📊 **{회사명} {분기} 실적** ({출처})\n매출 {매출액}[[ · YoY {매출_YoY}]][[ · 컨센 {매출_컨센대비}]]\n영업이익 {영업이익}[[ · YoY {영업이익_YoY}]][[ · 컨센 {영업이익_컨센대비}]]\n순이익 {순이익}[[ · YoY {순이익_YoY}]]\nEPS {EPS}[[ · 예상 {EPS_예상}]][[ ({EPS_컨센대비})]]\n{링크}' } },
    timing: { mode: 'realtime' }, options: {},
  },
  earnings_schedule: {
    name: '실적 발표 예정', icon: '🗓', desc: '관심 기업 실적 발표일을 미리 알려줘요',
    templates: { main: { label: '발표 예정', vars: ['회사명','티커','발표일','D데이','발표시간','EPS_예상','매출_예상'],
      def: '🗓 **{회사명}** ({티커}) 실적 발표 {D데이}\n📅 {발표일}[[ {발표시간}]]\n[[EPS 예상 {EPS_예상}]][[ · 매출 예상 {매출_예상}]]' } },
    timing: { offsets: [3, 1], hour: 9 }, options: {},
  },
  rate_kr: {
    name: '한국은행 기준금리', icon: '🇰🇷', desc: '금통위 결정을 발표 직후 알려주고, 회의 전에 미리 알려줘요',
    templates: {
      result: { label: '결정 발표', vars: RATE_RESULT_VARS,
        def: '🏦 **한국은행 기준금리 {결정}**\n{금리}[[ ({변동폭})]][[ · 이전 {이전금리}]]\n📈 {추세}\n[[최근 변경 {마지막변경}]]\n{링크}' },
      preview: { label: '회의 전 예고', vars: RATE_PREVIEW_VARS,
        def: '🏦 **금통위 {D데이}** · {회의일}\n현재 기준금리 {현재금리}\n📈 {추세}' },
    },
    timing: { result: true, before: [1], hour: 8 }, options: {},
  },
  rate_us: {
    name: '미국 연준 기준금리', icon: '🇺🇸', desc: 'FOMC 결정을 발표 직후 알려주고, 회의 전에 미리 알려줘요',
    templates: {
      result: { label: '결정 발표', vars: RATE_RESULT_VARS,
        def: '🏦 **미 연준 기준금리 {결정}**\n목표 범위 {금리}[[ ({변동폭})]][[ · 이전 {이전금리}]]\n📈 {추세}\n[[최근 변경 {마지막변경}]]\n{링크}' },
      preview: { label: '회의 전 예고', vars: RATE_PREVIEW_VARS,
        def: '🏦 **FOMC {D데이}** · {회의일}\n현재 목표 범위 {현재금리}\n📈 {추세}' },
    },
    timing: { result: true, before: [1], hour: 8 }, options: {},
  },
  morning_brief: {
    name: '아침 브리핑', icon: '☀️', desc: '정해진 시간에 시장 지표와 오늘 일정을 모아서 보내줘요',
    templates: { main: { label: '브리핑', vars: ['날짜','시장지표','경제지표','실적발표','금리일정','어제공시'],
      def: '☀️ **{날짜} 아침 브리핑**\n\n{시장지표}\n\n{경제지표}\n\n{실적발표}\n\n{금리일정}\n\n{어제공시}' } },
    timing: { hour: 8, days: [1,2,3,4,5] },
    options: { blocks: ['market','econ','earnings','rates','disclosures'] },
  },
};

var CAT_KO = { earnings: '실적', major: '주요사항', ownership: '지분·내부자', other: '기타' };
var BLOCKS = { market: '시장 지표', econ: '오늘 주요 경제지표', earnings: '관심 기업 실적 발표', rates: '금리 결정 일정', disclosures: '어제 관심 기업 공시' };
// 아침 브리핑에 바로 추가할 수 있는 자주 쓰는 지표 (Yahoo Finance 심볼)
var PRESETS = [
  { label: '미국 3개월', symbol: '^IRX', kind: 'yield' }, { label: '미국 5년', symbol: '^FVX', kind: 'yield' },
  { label: '미국 10년', symbol: '^TNX', kind: 'yield' }, { label: '미국 30년', symbol: '^TYX', kind: 'yield' },
  { label: '원/달러', symbol: 'KRW=X', kind: 'fx' }, { label: '엔/원', symbol: 'JPYKRW=X', kind: 'fx' },
  { label: '달러인덱스', symbol: 'DX-Y.NYB', kind: 'index' }, { label: 'VIX', symbol: '^VIX', kind: 'index' },
  { label: '코스피', symbol: '^KS11', kind: 'index' }, { label: '코스닥', symbol: '^KQ11', kind: 'index' },
  { label: 'S&P 500', symbol: '^GSPC', kind: 'index' }, { label: '나스닥', symbol: '^IXIC', kind: 'index' },
  { label: '다우', symbol: '^DJI', kind: 'index' }, { label: '필라델피아 반도체', symbol: '^SOX', kind: 'index' },
  { label: '니케이', symbol: '^N225', kind: 'index' }, { label: 'WTI 유가', symbol: 'CL=F', kind: 'price' },
  { label: '금', symbol: 'GC=F', kind: 'price' }, { label: '비트코인', symbol: 'BTC-USD', kind: 'price' },
];

var KR_CAT = [
  ['earnings', /잠정\)?실적|분기보고서|반기보고서|사업보고서|매출액또는손익구조|영업실적/],
  ['ownership', /대량보유|임원ㆍ주요주주|임원·주요주주|최대주주|특정증권등소유/],
  ['major', /주요사항보고서|유상증자|무상증자|자기주식|합병|분할|영업양수|영업양도|자산양수|자산양도|전환사채|신주인수권|교환사채|감자|소송|단일판매|공급계약|배당|투자판단|타법인주식|증권신고서|상장폐지|거래정지/],
];
var US_ITEMS = { '1.01': '중요 계약 체결', '1.02': '중요 계약 종료', '1.05': '사이버보안 사고', '2.01': '자산 인수·처분', '2.02': '실적 발표',
  '2.03': '채무 발생', '2.05': '구조조정', '2.06': '자산 손상', '3.01': '상장 관련 통지', '3.02': '비등록 증권 발행', '3.03': '주주 권리 변경',
  '4.01': '감사인 변경', '4.02': '재무제표 신뢰성 문제', '5.02': '임원 변경', '5.03': '정관 변경', '5.07': '주주총회 결과',
  '7.01': '공정공시(Reg FD)', '8.01': '기타 중요 사항', '9.01': '재무제표·첨부' };
var US_FORMS = { '10-Q': '분기보고서', '10-K': '연간보고서', '8-K': '수시공시', '4': '내부자 거래', '3': '내부자 최초 보유 신고', '5': '내부자 연간 거래',
  'SC 13D': '5% 이상 지분 보유(경영참여)', 'SC 13G': '5% 이상 지분 보유(단순투자)', 'SCHEDULE 13D': '5% 이상 지분 보유(경영참여)',
  'SCHEDULE 13G': '5% 이상 지분 보유(단순투자)', 'S-1': '증권 신고서', 'S-3': '증권 신고서', 'DEF 14A': '주총 위임장', '144': '내부자 매도 예정',
  '6-K': '수시공시(해외기업)', '20-F': '연간보고서(해외기업)' };

module.exports = function createBot(d) {

  // ── 날짜/포맷 헬퍼 ──
  function kst(offsetDays) { return new Date(Date.now() + 9*3600000 + (offsetDays||0)*86400000); }
  function kstDate(offsetDays) { return kst(offsetDays).toISOString().slice(0,10); }
  function etDate() { return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })).toISOString().slice(0,10); }
  function addDays(ymd, n) { return new Date(new Date(ymd+'T00:00:00Z').getTime() + n*86400000).toISOString().slice(0,10); }
  function dayDiff(a, b) { return Math.round((new Date(a+'T00:00:00Z') - new Date(b+'T00:00:00Z')) / 86400000); }
  function md(ymd) { var x = new Date(ymd+'T00:00:00Z'); return (x.getUTCMonth()+1)+'/'+x.getUTCDate()+'('+DOW[x.getUTCDay()]+')'; }
  function nowLabel() { var k = kst(); return md(k.toISOString().slice(0,10))+' '+String(k.getUTCHours()).padStart(2,'0')+':'+String(k.getUTCMinutes()).padStart(2,'0'); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function parseJson(s, fb) { try { var v = JSON.parse(s); return v == null ? fb : v; } catch(_) { return fb; } }
  function raw(x) { return x && x.raw != null ? x.raw : (typeof x === 'number' ? x : null); }
  function arrow(x) { return x > 0 ? '▲' : x < 0 ? '▼' : '─'; }
  function signed(x, digits, suffix) { return (x > 0 ? '+' : '') + x.toFixed(digits) + (suffix || ''); }
  function enc(s) { return encodeURIComponent(s); }

  // 억원 단위 → '195.0조' / '1,234억'
  // 억원 단위 → '9조 6,434억원' / '7,560억원' / '195조원'
  function fmtKrw(eok) {
    if (eok == null || isNaN(eok)) return '';
    var sign = eok < 0 ? '-' : '', a = Math.round(Math.abs(eok)), jo = Math.floor(a / 10000), rest = a % 10000;
    if (!jo) return sign + rest.toLocaleString('en-US') + '억원';
    return sign + jo.toLocaleString('en-US') + '조' + (rest ? ' ' + rest.toLocaleString('en-US') + '억원' : '원');
  }
  function opmText(op, sales) { return op != null && sales ? (op / sales * 100).toFixed(1) + '%' : ''; }
  function opmDiff(op1, s1, op0, s0) { return op1 != null && s1 && op0 != null && s0 ? signed((op1 / s1 - op0 / s0) * 100, 1, '%p') : ''; }
  function shortQ(year, q) { return q + 'Q' + String(year).slice(2); }
  function fmtUsd(v) {
    if (v == null || isNaN(v)) return '';
    var a = Math.abs(v), s = v < 0 ? '-' : '';
    if (a >= 1e12) return s + '$' + (a/1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + '$' + (a/1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a/1e6).toFixed(1) + 'M';
    return s + '$' + Math.round(a).toLocaleString('en-US');
  }
  function yoyCalc(cur, prev) {
    if (cur == null || prev == null) return '';
    if (prev <= 0 && cur > 0) return '흑자전환';
    if (prev > 0 && cur <= 0) return '적자전환';
    if (prev < 0 && cur < 0) return '적자지속';
    if (prev === 0) return '';
    return signed((cur - prev) / Math.abs(prev) * 100, 1, '%');
  }
  // 컨센서스 대비 — ±1% 이내는 '부합'
  function vsPct(pct) {
    if (pct == null || isNaN(pct)) return '';
    return (Math.abs(pct) < 1 ? '부합' : pct > 0 ? '상회' : '하회') + ' ' + signed(pct, 1, '%');
  }
  function vsCons(actual, cons) { if (actual == null || !cons) return ''; return vsPct((actual - cons) / Math.abs(cons) * 100); }
  // '상회 +9.6%' → {X_컨센판정} = '상회'
  function judgeAll(v) {
    ['매출', '영업이익', '영업이익률', 'EPS'].forEach(function(k) { v[k + '_컨센판정'] = (v[k + '_컨센대비'] || '').split(' ')[0]; });
  }
  function calLabel(ymd) { var y = +ymd.slice(0,4), m = +ymd.slice(5,7); return Math.ceil(m/3) + 'Q' + y; }
  function calKo(label) { var m = label.match(/^(\d)Q(\d{4})$/); return m ? m[2] + '년 ' + m[1] + '분기' : label; }

  // ── Supabase ──
  async function sel(path) {
    var r = await d.supaRest('GET', '/rest/v1/' + path, null);
    if (r.status >= 300) throw new Error('DB ' + r.status + ' ' + r.body.slice(0, 120));
    return parseJson(r.body, []);
  }
  function patch(table, filter, body) { return d.supaRest('PATCH', '/rest/v1/' + table + '?' + filter, body); }

  async function loadSettings() {
    var rows = [];
    try { rows = await sel('bot_alert_settings?select=*'); } catch(_) {}
    var out = {};
    Object.keys(META).forEach(function(t) {
      var m = META[t], row = rows.find(function(r){ return r.alert_type === t; }) || {}, tpls = {};
      Object.keys(m.templates).forEach(function(k) { tpls[k] = (row.templates && row.templates[k]) || m.templates[k].def; });
      out[t] = {
        enabled: row.enabled != null ? row.enabled : true, templates: tpls,
        timing: Object.assign({}, m.timing, row.timing || {}), options: Object.assign({}, m.options, row.options || {}),
      };
    });
    return out;
  }
  async function loadCompanies() {
    try { return await sel('bot_watch_companies?select=*&order=created_at.asc'); } catch(_) { return []; }
  }

  // ── 발송 기록 (중복 방지) ──
  // 같은 알림이 두 번 나가지 않도록 dedupe_key로 먼저 자리를 잡고(insert ignore) 보낸다. 전송 실패 시 자리를 지워 다음 tick에 재시도
  async function claim(type, key, status, title) {
    var r = await d.supaRest('POST', '/rest/v1/bot_message_log?on_conflict=dedupe_key',
      { alert_type: type, dedupe_key: key, status: status || 'pending', title: title || null },
      'resolution=ignore-duplicates,return=representation');
    if (r.status >= 300) throw new Error('bot_message_log ' + r.status + ' ' + r.body.slice(0, 120));
    return parseJson(r.body, []).length > 0;
  }
  async function logged(key) { return (await sel('bot_message_log?select=id&dedupe_key=eq.' + enc(key))).length > 0; }
  async function deliver(type, key, text, title) {
    if (!(await claim(type, key, 'pending', title))) return false;
    var ok = await sendTelegram(text);
    if (ok) await patch('bot_message_log', 'dedupe_key=eq.' + enc(key), { status: 'sent', text: text });
    else await d.supaRest('DELETE', '/rest/v1/bot_message_log?dedupe_key=eq.' + enc(key), null);
    return ok;
  }

  // ── 텔레그램 (토큰은 Vercel 환경변수 TELEGRAM_BOT_TOKEN, chat_id는 settings.telegram_chat_id) ──
  function tgApi(method, body) {
    var token = process.env.TELEGRAM_BOT_TOKEN || '';
    return new Promise(function(resolve, reject) {
      if (!token) return reject(new Error('TELEGRAM_BOT_TOKEN 환경변수 없음'));
      var data = JSON.stringify(body || {});
      var req2 = https.request({ hostname: 'api.telegram.org', path: '/bot' + token + '/' + method, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 10000,
      }, function(resp) {
        var c = []; resp.on('data', function(x){ c.push(x); });
        resp.on('end', function(){ resolve(parseJson(Buffer.concat(c).toString('utf8'), {})); });
      });
      req2.on('error', reject); req2.on('timeout', function(){ req2.destroy(); reject(new Error('timeout')); });
      req2.write(data); req2.end();
    });
  }
  // 텔레그램 한 메시지 최대 4096자 → 문단 단위로 나눠 보냄
  function splitMessage(s, max) {
    if (s.length <= max) return [s];
    var out = [], cur = '';
    s.split('\n\n').forEach(function(p) {
      while (p.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(p.slice(0, max)); p = p.slice(max); }
      if ((cur ? cur.length + 2 : 0) + p.length > max) { out.push(cur); cur = p; } else cur = cur ? cur + '\n\n' + p : p;
    });
    if (cur) out.push(cur);
    return out;
  }
  async function sendTelegram(html) {
    if (!process.env.TELEGRAM_BOT_TOKEN || !html) return false;
    var chatId = await d.getSetting('telegram_chat_id');
    if (!chatId) return false;
    for (var part of splitMessage(html, 3900)) {
      var r = null;
      try { r = await tgApi('sendMessage', { chat_id: chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true }); } catch(_) {}
      if (!r || !r.ok) return false;
    }
    return true;
  }

  // ── 템플릿 ──
  // {변수} 치환. 값이 없는 변수가 들어간 줄은 통째로 빠지고, [[ ... ]] 구간은 안의 변수가 비면 그 구간만 빠진다. **굵게** 지원
  // (한 칸 대괄호 [ ]는 글자 그대로 — '[삼성전자] 3Q26 실적' 같은 제목용)
  function render(tpl, vars) {
    var known = function(k) { return Object.prototype.hasOwnProperty.call(vars, k); };
    var has = function(k) { return vars[k] != null && String(vars[k]) !== ''; };
    var keysOf = function(s) { return (s.match(/\{[^{}\n]+\}/g) || []).map(function(k){ return k.slice(1, -1); }); };
    // 빈 줄로 나뉜 문단 단위로 처리 — 첫 줄(제목)만 남고 나머지가 전부 빠진 문단은 제목('<3Q26 컨센서스>' 등)까지 뺀다
    var paras = String(tpl || '').split(/\n[ \t]*\n/).map(function(para) {
      var src = para.split('\n'), out = [], firstKept = false;
      src.forEach(function(line, i) {
        var stripped = line.replace(/\[\[(.*?)\]\]/g, function(_, seg) {
          return keysOf(seg).every(function(k){ return !known(k) || has(k); }) ? seg : '';
        });
        if (keysOf(stripped).some(function(k){ return known(k) && !has(k); })) return;
        if (line.trim() && !stripped.trim()) return;
        if (i === 0) firstKept = true;
        out.push(esc(stripped).replace(/\{([^{}\n]+)\}/g, function(m, k) { return known(k) ? esc(vars[k]) : m; }));
      });
      return src.length >= 2 && firstKept && out.length === 1 ? '' : out.join('\n');
    });
    return paras.filter(function(p){ return p.trim(); }).join('\n\n').replace(/\n{3,}/g, '\n\n').trim().replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
  }
  function emptyVars(type, key) {
    var v = {}; META[type].templates[key || 'main'].vars.forEach(function(k){ v[k] = ''; }); return v;
  }

  // ── 외부 데이터 ──
  function fetchPage(url, headers) {
    var u = new URL(url);
    return d.httpsGetRaw(u.hostname, u.pathname + u.search, headers || { 'User-Agent': BROWSER_UA });
  }
  async function yahooSummary(symbol, modules) {
    var c = await d.getYahooCrumb();
    var r = await d.httpsGetRaw('query2.finance.yahoo.com', '/v10/finance/quoteSummary/' + enc(symbol) + '?modules=' + modules + '&crumb=' + enc(c.crumb),
      { 'User-Agent': BROWSER_UA, 'Cookie': c.cookie });
    var j = parseJson(r.body, null), res = j && j.quoteSummary && j.quoteSummary.result && j.quoteSummary.result[0];
    if (!res) throw new Error('Yahoo ' + symbol + ' HTTP ' + r.status);
    return res;
  }
  // 일봉 1개월 → { v: 현재가, prev: 직전 종가, first: 1개월 전 종가, name }
  async function yahooChart(symbol) {
    var r = await fetchPage('https://query1.finance.yahoo.com/v8/finance/chart/' + enc(symbol) + '?interval=1d&range=1mo');
    var j = parseJson(r.body, null), res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res) throw new Error('Yahoo chart ' + symbol + ' HTTP ' + r.status);
    var closes = ((res.indicators.quote[0] || {}).close || []).filter(function(v){ return v != null; });
    var v = res.meta.regularMarketPrice != null ? res.meta.regularMarketPrice : closes[closes.length - 1];
    return { v: v, prev: closes.length >= 2 ? closes[closes.length - 2] : null, first: closes.length ? closes[0] : null,
      name: res.meta.shortName || res.meta.longName || symbol, currency: res.meta.currency };
  }
  // 하루 한 번만 받아오면 되는 데이터는 settings에 날짜와 함께 캐시
  async function cachedDaily(key, fetcher) {
    var c = parseJson(await d.getSetting(key) || 'null', null);
    if (c && c.fetched === kstDate(0)) return c.data;
    try {
      var data = await fetcher();
      if (data && (!Array.isArray(data) || data.length)) { await d.setSetting(key, JSON.stringify({ fetched: kstDate(0), data: data })); return data; }
    } catch(_) {}
    return c ? c.data : null;
  }

  // ════════════ 국내 공시 (DART) ════════════
  function classifyKR(nm) { for (var c of KR_CAT) if (c[1].test(nm)) return c[0]; return 'other'; }
  function isKrEarningsReport(nm) { return !/정정/.test(nm) && /잠정\)?실적|^분기보고서|^반기보고서|^사업보고서/.test(nm); }

  // 회사별 조회 대신 최근 전체 공시를 한 번에 받아 관심 기업만 거름 (관심 기업 수와 무관하게 분당 1~2회 호출)
  async function stepDartKR(S, companies) {
    var key = d.dartKey();
    if (!key) return 'DART_API_KEY 없음';
    var cursor = await d.getSetting('dart_global_cursor');
    var bgn = kstDate(-1).replace(/-/g, ''), end = kstDate(0).replace(/-/g, '');
    var items = [];
    for (var page = 1; page <= 5; page++) {
      var lr = await d.dartGetJson('/api/list.json?crtfc_key=' + enc(key) + '&bgn_de=' + bgn + '&end_de=' + end +
        '&page_no=' + page + '&page_count=100&sort=date&sort_mth=desc');
      if (lr.status !== 200) return 'DART HTTP ' + lr.status + (lr.location ? ' → ' + lr.location : '');
      var ld = parseJson(lr.body, null);
      if (!ld) return 'DART 응답 파싱 실패 ' + lr.body.slice(0, 120);
      if (ld.status === '013') break; // 조회된 데이터 없음
      if (ld.status !== '000') return 'DART ' + ld.status + ' ' + ld.message;
      items = items.concat(ld.list || []);
      // 커서보다 오래된 공시까지 내려왔으면 그만 (첫 실행이면 1페이지만)
      var minNo = (ld.list || []).reduce(function(m, it){ return it.rcept_no < m ? it.rcept_no : m; }, '99999999999999');
      if (!cursor || minNo <= cursor || page >= ld.total_page) break;
    }
    if (!items.length) return { scanned: 0 };
    var maxNo = items.reduce(function(m, it){ return it.rcept_no > m ? it.rcept_no : m; }, '');
    // 첫 실행: 커서만 잡고 과거 공시는 알리지 않음
    if (!cursor) { await d.setSetting('dart_global_cursor', maxNo); return { init: maxNo }; }

    var wantDisc = S.disclosure.enabled, wantER = S.earnings_result.enabled, byCorp = {};
    companies.forEach(function(c) {
      if (c.market === 'KR' && c.corp_code && ((wantDisc && c.alert_disclosure) || (wantER && c.alert_earnings))) byCorp[c.corp_code] = c;
    });
    var fresh = items.filter(function(it){ return it.rcept_no > cursor && byCorp[it.corp_code]; })
      .sort(function(a, b){ return a.rcept_no.localeCompare(b.rcept_no); });

    var notified = 0, errors = [];
    for (var it of fresh) {
      var c = byCorp[it.corp_code], nm = it.report_nm.replace(/\s+/g, ' ').trim(), cat = classifyKR(nm);
      var link = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + it.rcept_no;
      if (wantDisc && c.alert_disclosure && (S.disclosure.options.categories || []).indexOf(cat) >= 0) {
        var vars = { 회사명: c.name, 티커: c.ticker, 시장: '국내', 분류: CAT_KO[cat], 공시명: nm, 시각: nowLabel(), 링크: link };
        await discDeliver(S, 'disc:KR:' + it.rcept_no, render(S.disclosure.templates.main, vars), c.name + ' · ' + nm, link);
        notified++;
      }
      if (wantER && c.alert_earnings && isKrEarningsReport(nm)) {
        try {
          var ev = await krEarningsVars(c, it.rcept_no, nm, link);
          if (ev) await deliver('earnings_result', 'er:KR:' + it.rcept_no, await renderEarnings(S.earnings_result.templates.main, ev), c.name + ' · ' + ev.분기 + ' 실적');
        } catch(e) { errors.push(c.name + ': ' + e.message); }
      }
    }
    if (maxNo > cursor) await d.setSetting('dart_global_cursor', maxNo);
    return { scanned: items.length, notified: notified, errors: errors.length ? errors : undefined };
  }

  // 실시간 모드면 바로 보내고, '하루 한 번 모아서' 모드면 대기열(queued)에 쌓아둔다
  async function discDeliver(S, key, text, title, url) {
    if (S.disclosure.timing.mode === 'digest') {
      if (await claim('disclosure', key, 'queued', title)) await patch('bot_message_log', 'dedupe_key=eq.' + enc(key), { text: text });
      return;
    }
    if ((await deliver('disclosure', key, text, title)) && d.webPushAll) {
      try { await d.webPushAll({ title: '📢 ' + title.split(' · ')[0] + ' 새 공시', body: title.split(' · ').slice(1).join(' · '), tag: key, url: url }); } catch(_) {}
    }
  }

  // 잠정실적 공시 원문(XML) 표에서 매출/영업이익/순이익의 당기·전년동기대비를 읽음
  async function parseProvisional(rceptNo) {
    var r = await d.httpsGetBuffer('opendart.fss.or.kr', '/api/document.xml?crtfc_key=' + enc(d.dartKey()) + '&rcept_no=' + rceptNo);
    if (r.status !== 200) return null;
    var AdmZip = require('adm-zip'), zip;
    try { zip = new AdmZip(r.buffer); } catch(_) { return null; }
    var xml = zip.getEntries().map(function(e){ return zip.readAsText(e); }).join('\n');
    var rows = xml.split(/<tr[^>]*>/i).map(function(row) {
      return row.split(/<\/t[dehu]>/i).map(function(x){ return x.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim(); });
    });
    var unit = 1;
    rows.some(function(row) {
      var u = row.find(function(c){ return /단위\s*:/.test(c); });
      if (!u) return false;
      unit = /조원/.test(u) ? 10000 : /억원/.test(u) ? 1 : /백만원/.test(u) ? 0.01 : /천원/.test(u) ? 0.00001 : /원/.test(u) ? 1e-8 : 1;
      return true;
    });
    var out = { rows: {}, note: '' };
    rows.some(function(row) {
      // 회사마다 '(26.3Q)' 또는 "('26.3Q)"
      var m = (row[0] || '').match(/^\('?(\d{2})\.(\d)Q\)$/);
      if (m) { out.year = 2000 + +m[1]; out.q = +m[2]; out.qkey = out.year + String(out.q * 3).padStart(2, '0'); }
      return !!m;
    });
    var num = function(s) { var v = parseFloat(String(s).replace(/,/g, '')); return isNaN(v) ? null : v; };
    var change = function(pct, turn) { return turn && turn !== '-' ? turn : pct == null ? '' : signed(pct, 1, '%'); };
    // 열: 구분 | 당해실적 | 당기 | 전기 | 전기대비% | 전환 | 전년동기 | 전년동기대비% | 전환
    rows.forEach(function(row) {
      if (row[1] !== '당해실적' || out.rows[row[0]]) return;
      var scale = function(v) { return v == null ? null : v * unit; };
      out.rows[row[0]] = { cur: scale(num(row[2])), prev: scale(num(row[3])), ago: scale(num(row[6])),
        qoq: change(num(row[4]), row[5]), yoy: change(num(row[7]), row[8]) };
    });
    // '4. 기타 투자판단과 관련한 중요사항' 본문 (일회성 요인 설명 등)
    rows.forEach(function(row, i) {
      if (out.note || !/^4\.\s*기타 투자판단/.test(row[0] || '')) return;
      var next = (rows[i + 1] || []).filter(Boolean)[0] || '';
      out.note = next.replace(/\s+([나다라마바사아자차카타파하])\.\s/g, '\n$1. ').trim();
    });
    return out;
  }

  // 네이버 증권 분기 컨센서스 (억원) — 해당 분기 열이 아직 추정치(isConsensus Y)일 때만
  async function naverConsensus(code, qkey) {
    var r = await fetchPage('https://m.stock.naver.com/api/stock/' + code + '/finance/quarter');
    var j = parseJson(r.body, null), fi = j && j.financeInfo;
    if (!fi) return null;
    var col = (fi.trTitleList || []).find(function(t){ return t.key === qkey; });
    if (!col || col.isConsensus !== 'Y') return null;
    var out = {};
    (fi.rowList || []).forEach(function(row) {
      var c = row.columns && row.columns[qkey], v = c && parseFloat(String(c.value).replace(/,/g, ''));
      if (!isNaN(v)) out[row.title] = v;
    });
    return out;
  }

  async function krEarningsVars(c, rceptNo, nm, link) {
    var v = Object.assign(emptyVars('earnings_result'), { 회사명: c.name, 티커: c.ticker, 링크: link });
    if (/잠정/.test(nm)) {
      var p = await parseProvisional(rceptNo);
      if (!p || !p.rows['매출액']) return null;
      var cons = p.qkey ? await naverConsensus(c.ticker, p.qkey).catch(function(){ return null; }) : null;
      v.분기 = p.year ? p.year + '년 ' + p.q + '분기' : '';
      v.분기약칭 = p.year ? shortQ(p.year, p.q) : '';
      v.출처 = '잠정실적';
      v.기타사항 = p.note;
      var sales = p.rows['매출액'] || {}, op = p.rows['영업이익'] || {}, ni = p.rows['당기순이익'] || {};
      if (ni.cur == null) ni = p.rows['지배기업 소유주지분 순이익'] || ni;
      if (sales.cur != null) { v.매출액 = fmtKrw(sales.cur); v.매출_YoY = sales.yoy; v.매출_QoQ = sales.qoq; }
      if (op.cur != null) { v.영업이익 = fmtKrw(op.cur); v.영업이익_YoY = op.yoy; v.영업이익_QoQ = op.qoq; }
      if (ni.cur != null) { v.순이익 = fmtKrw(ni.cur); v.순이익_YoY = ni.yoy; v.순이익_QoQ = ni.qoq; }
      v.영업이익률 = opmText(op.cur, sales.cur);
      v.영업이익률_YoY = opmDiff(op.cur, sales.cur, op.ago, sales.ago);
      v.영업이익률_QoQ = opmDiff(op.cur, sales.cur, op.prev, sales.prev);
      if (cons) {
        if (cons['매출액'] != null && sales.cur != null) { v.매출_컨센서스 = fmtKrw(cons['매출액']); v.매출_컨센대비 = vsCons(sales.cur, cons['매출액']); }
        if (cons['영업이익'] != null && op.cur != null) { v.영업이익_컨센서스 = fmtKrw(cons['영업이익']); v.영업이익_컨센대비 = vsCons(op.cur, cons['영업이익']); }
        // 영업이익률은 %p 차이로 판정 (±0.1%p 이내 부합)
        var consOpm = cons['영업이익'] != null && cons['매출액'] ? cons['영업이익'] / cons['매출액'] * 100 : cons['영업이익률'];
        if (consOpm != null && v.영업이익률) {
          var dp = op.cur / sales.cur * 100 - consOpm;
          v.영업이익률_컨센서스 = consOpm.toFixed(1) + '%';
          v.영업이익률_컨센대비 = (Math.abs(dp) < 0.1 ? '부합' : dp > 0 ? '상회' : '하회') + ' ' + signed(dp, 1, '%p');
        }
      }
      judgeAll(v);
      return v;
    }
    // 정기보고서: DART 단일회사 주요계정 (당기 vs 전년 동기)
    var pm = nm.match(/\((\d{4})\.(\d{2})\)/);
    if (!pm) return null;
    var annual = /^사업보고서/.test(nm);
    var reprt = annual ? '11011' : { '03': '11013', '06': '11012', '09': '11014' }[pm[2]];
    if (!reprt) return null;
    var r = await d.dartGetJson('/api/fnlttSinglAcnt.json?crtfc_key=' + enc(d.dartKey()) + '&corp_code=' + c.corp_code + '&bsns_year=' + pm[1] + '&reprt_code=' + reprt);
    var j = parseJson(r.body, {}), list = j.list || [];
    var fs = list.some(function(x){ return x.fs_div === 'CFS'; }) ? 'CFS' : 'OFS';
    var amt = function(re) {
      var row = list.find(function(x){ return x.fs_div === fs && x.sj_div === 'IS' && re.test(x.account_nm.replace(/\s/g, '')); });
      var n = function(s) { var x = parseFloat(String(s || '').replace(/,/g, '')); return isNaN(x) ? null : x / 1e8; };
      return row ? { cur: n(row.thstrm_amount), prev: n(row.frmtrm_amount) } : null;
    };
    var s = amt(/^(매출액|수익\(매출액\)|영업수익|매출)$/), o = amt(/^영업이익(\(손실\))?$/), n2 = amt(/^당기순이익(\(손실\))?$/);
    if (!s && !o) return null;
    v.분기 = annual ? pm[1] + '년 연간' : pm[1] + '년 ' + (+pm[2] / 3) + '분기';
    v.분기약칭 = annual ? 'FY' + pm[1].slice(2) : shortQ(pm[1], +pm[2] / 3);
    v.출처 = nm.split(' ')[0];
    if (s && s.cur != null) { v.매출액 = fmtKrw(s.cur); v.매출_YoY = yoyCalc(s.cur, s.prev); }
    if (o && o.cur != null) { v.영업이익 = fmtKrw(o.cur); v.영업이익_YoY = yoyCalc(o.cur, o.prev); }
    if (n2 && n2.cur != null) { v.순이익 = fmtKrw(n2.cur); v.순이익_YoY = yoyCalc(n2.cur, n2.prev); }
    if (s && o) { v.영업이익률 = opmText(o.cur, s.cur); v.영업이익률_YoY = opmDiff(o.cur, s.cur, o.prev, s.prev); }
    return v;
  }

  // ── AI 한줄평 (Claude) — 템플릿에 {AI_한줄평}/{AI_점수}가 있을 때만 호출 ──
  function needsAi(tpl) { return /\{AI_(한줄평|점수)\}/.test(tpl || ''); }
  var AI_SCHEMA = {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '실적 흐름을 설명하는 한국어 1~2문장' },
      score: { type: 'integer', description: '0~100 실적 점수' },
    },
    required: ['summary', 'score'],
    additionalProperties: false,
  };
  var AI_SYSTEM = '너는 상장사 분기 실적을 빠르게 평가하는 주식 애널리스트다. 주어진 수치만 근거로 판단하고, 없는 숫자를 지어내지 마라.\n' +
    'summary: 이번 실적이 어떤 흐름인지 한국어 1~2문장 (성장·둔화 방향, 컨센서스 대비, 일회성 요인이 있으면 그 영향). 숫자 나열보다 해석 위주로.\n' +
    'score: 0~100 정수. 50은 시장 예상 수준, 컨센서스 상회와 성장 가속일수록 높게, 하회와 역성장일수록 낮게. 일회성 요인으로 부풀려진 부분은 감안해서.';
  async function addAiComment(v) {
    if (!process.env.ANTHROPIC_API_KEY) return v;
    var Anthropic = require('@anthropic-ai/sdk');
    var client = new (Anthropic.default || Anthropic)({ timeout: 25000, maxRetries: 1 });
    var facts = META.earnings_result.templates.main.vars
      .filter(function(k){ return !/^AI_|^링크$/.test(k) && v[k]; })
      .map(function(k){ return k + ': ' + v[k]; }).join('\n');
    var r = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: AI_SCHEMA } },
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: facts }],
    });
    if (r.stop_reason === 'refusal') return v;
    var j = parseJson(r.content.filter(function(b){ return b.type === 'text'; }).map(function(b){ return b.text; }).join(''), null);
    if (j && j.summary) {
      v.AI_한줄평 = j.summary;
      v.AI_점수 = Math.max(0, Math.min(100, Math.round(j.score))) + '점';
    }
    return v;
  }
  // 실적 결과 렌더링 — AI 변수가 템플릿에 있으면 먼저 채움 (실패해도 그 줄만 빠지고 알림은 나감)
  async function renderEarnings(tpl, v) {
    if (needsAi(tpl)) { try { await addAiComment(v); } catch(_) {} }
    return render(tpl, v);
  }

  // ════════════ 미국 공시 (SEC EDGAR) ════════════
  function classifyUS(form, items) {
    var f = form.replace(/\/A$/, '');
    if (f === '10-Q' || f === '10-K' || f === '20-F' || (f === '8-K' && items.indexOf('2.02') >= 0)) return 'earnings';
    if (['3','4','5','144','SC 13D','SC 13G','SCHEDULE 13D','SCHEDULE 13G'].indexOf(f) >= 0) return 'ownership';
    if (['8-K','6-K','S-1','S-3','S-4','424B2','424B3','424B4','424B5','DEF 14A'].indexOf(f) >= 0) return 'major';
    return 'other';
  }
  function usTitle(form, items) {
    var f = form.replace(/\/A$/, ''), s = (US_FORMS[f] || f) + ' (' + form + ')';
    var named = items.filter(function(i){ return i !== '9.01'; }).map(function(i){ return US_ITEMS[i] || ('Item ' + i); });
    return named.length ? s + ' — ' + named.join(', ') : s;
  }
  function unent(s) { return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"'); }

  async function secLatest(start) {
    var r = await d.httpsGetRaw('www.sec.gov', '/cgi-bin/browse-edgar?action=getcurrent&type=&company=&dateb=&owner=include&start=' + start + '&count=100&output=atom',
      { 'User-Agent': SEC_UA, 'Accept': 'application/atom+xml' });
    if (r.status !== 200) throw new Error('SEC HTTP ' + r.status);
    return (r.body.match(/<entry>[\s\S]*?<\/entry>/g) || []).map(function(x) {
      var title = unent(((x.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '').trim());
      var tm = title.match(/^(.+?) - (.+) \((\d{10})\) \((\w+)\)$/);
      var sum = unent((x.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || '');
      return {
        form: tm ? tm[1] : '', name: tm ? tm[2] : '', cik: tm ? String(+tm[3]) : '', role: tm ? tm[4] : '',
        link: (x.match(/<link[^>]*href="([^"]+)"/) || [])[1] || '',
        updated: Date.parse(((x.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '').trim()) || 0,
        acc: (x.match(/accession-number=([\d-]+)/) || [])[1] || '',
        items: (sum.match(/Item (\d+\.\d+)/g) || []).map(function(s){ return s.slice(5); }),
      };
    });
  }

  async function stepSecUS(S, companies) {
    var byCik = {};
    companies.forEach(function(c) {
      if (c.market === 'US' && c.cik && ((S.disclosure.enabled && c.alert_disclosure) || (S.earnings_result.enabled && c.alert_earnings))) byCik[String(+c.cik)] = c;
    });
    if (!Object.keys(byCik).length) return 'no companies';
    var cursor = Number(await d.getSetting('sec_cursor') || 0), entries = [];
    for (var p = 0; p < 4; p++) {
      var page = await secLatest(p * 100);
      entries = entries.concat(page);
      if (!cursor || !page.length) break;
      if (Math.min.apply(null, page.map(function(e){ return e.updated || Infinity; })) <= cursor) break;
    }
    var newest = entries.reduce(function(m, e){ return Math.max(m, e.updated); }, 0);
    if (!cursor) { await d.setSetting('sec_cursor', String(newest)); return { init: newest }; }

    var seen = {}, notified = 0;
    var fresh = entries.filter(function(e) {
      if (e.updated <= cursor || !byCik[e.cik] || !/Filer|Issuer|Subject/.test(e.role) || seen[e.acc]) return false;
      return (seen[e.acc] = true);
    }).sort(function(a, b){ return a.updated - b.updated; });

    for (var e of fresh) {
      var c = byCik[e.cik], cat = classifyUS(e.form, e.items), title = usTitle(e.form, e.items);
      if (S.disclosure.enabled && c.alert_disclosure && (S.disclosure.options.categories || []).indexOf(cat) >= 0) {
        var vars = { 회사명: c.name, 티커: c.ticker, 시장: '미국', 분류: CAT_KO[cat], 공시명: title, 시각: nowLabel(), 링크: e.link };
        await discDeliver(S, 'disc:US:' + e.acc, render(S.disclosure.templates.main, vars), c.name + ' · ' + title, e.link);
        notified++;
      }
      // 실적 8-K(Item 2.02)가 올라오면 Yahoo 실적 반영을 기다렸다가 결과 알림 (stepUsResults)
      if (c.alert_earnings && /^8-K/.test(e.form) && e.items.indexOf('2.02') >= 0) {
        c.state = Object.assign({}, c.state || {}, { pending_since: Date.now(), polled_at: 0 });
        await patch('bot_watch_companies', 'id=eq.' + c.id, { state: c.state });
      }
    }
    if (newest > cursor) await d.setSetting('sec_cursor', String(newest));
    return { scanned: entries.length, notified: notified };
  }

  // ════════════ 실적 (Yahoo) ════════════
  // Yahoo 분기 실적을 상태에 누적 — 발표 후엔 1년 전 분기가 목록에서 빠지므로 미리 저장해둬야 YoY 계산 가능
  function mergeHist(st, ys) {
    var fc = ys.earnings && ys.earnings.financialsChart && ys.earnings.financialsChart.quarterly || [];
    st.rev_hist = Object.assign({}, st.rev_hist || {}); st.ni_hist = Object.assign({}, st.ni_hist || {});
    fc.forEach(function(q) { if (raw(q.revenue) != null) st.rev_hist[q.date] = raw(q.revenue); if (raw(q.earnings) != null) st.ni_hist[q.date] = raw(q.earnings); });
    ['rev_hist', 'ni_hist'].forEach(function(k) {
      var keys = Object.keys(st[k]).sort(function(a, b){ return a.slice(2) + a[0] < b.slice(2) + b[0] ? -1 : 1; });
      keys.slice(0, Math.max(0, keys.length - 8)).forEach(function(x){ delete st[k][x]; });
    });
    var hist = (ys.earningsHistory && ys.earningsHistory.history || []).filter(function(h){ return raw(h.epsActual) != null && h.quarter; });
    if (hist.length && !st.last_quarter) st.last_quarter = hist[hist.length - 1].quarter.fmt;
    return hist;
  }

  function usResultVars(c, h, ys, st) {
    var v = Object.assign(emptyVars('earnings_result'), { 회사명: c.name, 티커: c.ticker, 출처: 'Yahoo Finance', 링크: 'https://finance.yahoo.com/quote/' + c.yahoo_symbol });
    var label = calLabel(h.quarter.fmt), ago = label.replace(/\d{4}$/, function(y){ return String(+y - 1); });
    var lm = label.match(/^(\d)Q(\d{4})$/), prevQ = lm[1] === '1' ? '4Q' + (+lm[2] - 1) : (+lm[1] - 1) + 'Q' + lm[2];
    v.분기 = calKo(label);
    v.분기약칭 = shortQ(lm[2], lm[1]);
    var eps = raw(h.epsActual), est = raw(h.epsEstimate), sp = raw(h.surprisePercent);
    if (eps != null) v.EPS = '$' + eps.toFixed(2);
    if (est != null) v.EPS_예상 = '$' + est.toFixed(2);
    if (sp != null) v.EPS_컨센대비 = vsPct(sp * 100); else if (eps != null && est) v.EPS_컨센대비 = vsCons(eps, est);
    var fc = (ys.earnings && ys.earnings.financialsChart && ys.earnings.financialsChart.quarterly || []).find(function(q){ return q.date === label; });
    if (fc && raw(fc.revenue) != null) {
      v.매출액 = fmtUsd(raw(fc.revenue));
      if (st.rev_hist && st.rev_hist[ago] != null) v.매출_YoY = yoyCalc(raw(fc.revenue), st.rev_hist[ago]);
      if (st.rev_hist && st.rev_hist[prevQ] != null) v.매출_QoQ = yoyCalc(raw(fc.revenue), st.rev_hist[prevQ]);
      var e = estFor(st);
      if (e && e.rev) { v.매출_컨센서스 = fmtUsd(e.rev); v.매출_컨센대비 = vsCons(raw(fc.revenue), e.rev); }
    }
    if (fc && raw(fc.earnings) != null) {
      v.순이익 = fmtUsd(raw(fc.earnings));
      if (st.ni_hist && st.ni_hist[ago] != null) v.순이익_YoY = yoyCalc(raw(fc.earnings), st.ni_hist[ago]);
      if (st.ni_hist && st.ni_hist[prevQ] != null) v.순이익_QoQ = yoyCalc(raw(fc.earnings), st.ni_hist[prevQ]);
    }
    judgeAll(v);
    return v;
  }
  // 발표 직전에 저장해둔 매출 컨센서스 (발표일 ±3일 이내 것)
  function estFor(st) {
    var today = etDate(), best = null;
    Object.keys(st.est_by_date || {}).forEach(function(dt) { if (Math.abs(dayDiff(dt, today)) <= 3) best = st.est_by_date[dt]; });
    return best;
  }

  // 관심 기업의 다음 실적일·컨센서스를 하루 한 번 갱신 (tick당 2개씩 나눠서)
  async function stepRefresh(companies) {
    var today = kstDate(0), done = [];
    var due = companies.filter(function(c){ return c.yahoo_symbol && c.alert_earnings && (!c.next_earnings || c.next_earnings.fetched !== today); }).slice(0, 2);
    for (var c of due) {
      var ne = Object.assign({}, c.next_earnings || {}, { fetched: today }), st = Object.assign({}, c.state || {});
      try {
        var ys;
        try { ys = await yahooSummary(c.yahoo_symbol, 'calendarEvents,earnings,earningsHistory'); }
        catch(e1) {
          // 예전 공시 알림에서 옮겨온 국내 종목은 코스피(.KS)로 가정했으므로 코스닥(.KQ)으로 한 번 더
          if (!/\.KS$/.test(c.yahoo_symbol)) throw e1;
          var kq = c.yahoo_symbol.replace(/\.KS$/, '.KQ');
          ys = await yahooSummary(kq, 'calendarEvents,earnings,earningsHistory');
          c.yahoo_symbol = kq;
          await patch('bot_watch_companies', 'id=eq.' + c.id, { yahoo_symbol: kq });
        }
        var ce = ys.calendarEvents && ys.calendarEvents.earnings || {}, ed = (ce.earningsDate || [])[0];
        ne.date = ed ? (ed.fmt || new Date(raw(ed) * 1000).toISOString().slice(0, 10)) : null;
        ne.estimate = !!ce.isEarningsDateEstimate;
        ne.eps_est = raw(ce.earningsAverage); ne.rev_est = raw(ce.revenueAverage); ne.hour = null;
        if (c.market === 'US' && ne.date) {
          try {
            var fr = await d.finnhubGet('/calendar/earnings?from=' + ne.date + '&to=' + ne.date + '&symbol=' + enc(c.ticker));
            var it = (parseJson(fr.body, {}).earningsCalendar || [])[0];
            if (it) ne.hour = it.hour || null;
          } catch(_) {}
        }
        mergeHist(st, ys);
        if (ne.date && ne.rev_est) {
          st.est_by_date = Object.assign({}, st.est_by_date || {});
          st.est_by_date[ne.date] = { rev: ne.rev_est, eps: ne.eps_est };
          Object.keys(st.est_by_date).sort().slice(0, -4).forEach(function(k){ delete st.est_by_date[k]; });
        }
        ne.error = null;
      } catch(e) { ne.error = e.message; }
      await patch('bot_watch_companies', 'id=eq.' + c.id, { next_earnings: ne, state: st });
      c.next_earnings = ne; c.state = st;
      done.push(c.ticker);
    }
    return done.length ? { refreshed: done } : 'none';
  }

  // 미국 기업: 실적 8-K가 올라왔거나 발표일 전후면 5분마다 Yahoo를 보고 새 분기 실적이 반영되면 결과 알림
  async function stepUsResults(S, companies) {
    if (!S.earnings_result.enabled) return 'off';
    var now = Date.now(), etToday = etDate(), sent = [];
    var due = companies.filter(function(c) {
      if (c.market !== 'US' || !c.alert_earnings || !c.yahoo_symbol) return false;
      var st = c.state || {}, ne = c.next_earnings || {};
      var pending = st.pending_since && now - st.pending_since < 3 * 86400000;
      var around = ne.date && etToday >= ne.date && dayDiff(etToday, ne.date) <= 2;
      return (pending || around) && (!st.polled_at || now - st.polled_at > 5 * 60000);
    }).slice(0, 3);
    for (var c of due) {
      var st = Object.assign({}, c.state || {}, { polled_at: now });
      try {
        var ys = await yahooSummary(c.yahoo_symbol, 'earnings,earningsHistory');
        var prevLast = st.last_quarter, hist = mergeHist(st, ys), last = hist[hist.length - 1];
        if (last && prevLast && last.quarter.fmt > prevLast) {
          var vars = usResultVars(c, last, ys, st);
          if (await deliver('earnings_result', 'er:US:' + c.ticker + ':' + last.quarter.fmt, await renderEarnings(S.earnings_result.templates.main, vars), c.name + ' · ' + vars.분기 + ' 실적')) {
            st.last_quarter = last.quarter.fmt; st.pending_since = null; sent.push(c.ticker);
          }
        }
      } catch(_) {}
      await patch('bot_watch_companies', 'id=eq.' + c.id, { state: st });
      c.state = st;
    }
    return due.length ? { polled: due.map(function(c){ return c.ticker; }), sent: sent } : 'none';
  }

  // 실적 발표일을 한국 날짜로 (미국 장 마감 후 발표는 한국시간 다음날 새벽)
  function earningsKst(c) {
    var ne = c.next_earnings || {};
    if (!ne.date) return null;
    if (c.market === 'US' && ne.hour === 'amc') return { date: addDays(ne.date, 1), label: '새벽 (미국 장 마감 후)' };
    if (c.market === 'US' && ne.hour === 'bmo') return { date: ne.date, label: '밤 (미국 장 시작 전)' };
    return { date: ne.date, label: '' };
  }
  function scheduleVars(c, dd) {
    var ev = earningsKst(c), ne = c.next_earnings || {}, us = c.market === 'US';
    return { 회사명: c.name, 티커: c.ticker, 발표일: md(ev.date) + (ne.estimate ? ' (예상일)' : ''), D데이: dd === 0 ? '오늘' : 'D-' + dd,
      발표시간: ev.label,
      EPS_예상: ne.eps_est == null ? '' : us ? '$' + ne.eps_est.toFixed(2) : Math.round(ne.eps_est).toLocaleString('en-US') + '원',
      매출_예상: ne.rev_est == null ? '' : us ? fmtUsd(ne.rev_est) : fmtKrw(ne.rev_est / 1e8) };
  }

  async function stepSchedule(S, companies) {
    var T = S.earnings_schedule;
    if (!T.enabled) return 'off';
    if (kst().getUTCHours() < (T.timing.hour != null ? T.timing.hour : 9)) return 'wait';
    var today = kstDate(0), offsets = T.timing.offsets || [], sent = [];
    for (var c of companies) {
      if (!c.alert_earnings) continue;
      var ev = earningsKst(c);
      if (!ev) continue;
      var dd = dayDiff(ev.date, today);
      if (offsets.indexOf(dd) < 0) continue;
      var key = 'es:' + c.market + ':' + c.ticker + ':' + c.next_earnings.date + ':' + dd;
      if (await deliver('earnings_schedule', key, render(T.templates.main, scheduleVars(c, dd)), c.name + ' 실적 발표 D-' + dd)) sent.push(c.ticker);
    }
    return { sent: sent };
  }

  // ════════════ 기준금리 ════════════
  async function fetchBokMeetings() {
    var r = await fetchPage('https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755');
    if (r.status !== 200) throw new Error('BOK HTTP ' + r.status);
    var year = kstDate(0).slice(0, 4), dates = [], re = /(\d{2})월\s*(\d{2})일\s*\([월화수목금]\)/g, m;
    var text = r.body.replace(/<[^>]+>/g, ' ');
    while ((m = re.exec(text))) dates.push(year + '-' + m[1] + '-' + m[2]);
    return dates.filter(function(x, i){ return dates.indexOf(x) === i; }).sort();
  }
  // FOMC 결정일 (2일 회의의 둘째 날, 미국 날짜)
  async function fetchFomcDates() {
    var r = await fetchPage('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm');
    if (r.status !== 200) throw new Error('Fed HTTP ' + r.status);
    var parts = r.body.split(/<h4><a id="\d+">(\d{4}) FOMC Meetings<\/a><\/h4>/), out = [];
    var MON = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
    for (var i = 1; i < parts.length; i += 2) {
      var re = /fomc-meeting__month[^>]*><strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)</g, m;
      while ((m = re.exec(parts[i + 1]))) {
        if (/notation|unscheduled/i.test(m[2])) continue;
        var months = m[1].split('/').map(function(s){ return MON[s.trim().slice(0, 3).toLowerCase()]; });
        var days = m[2].replace(/\*/g, '').trim().split('-').map(function(s){ return parseInt(s, 10); });
        var mon = months[months.length - 1], day = days[days.length - 1];
        if (mon && day) out.push(parts[i] + '-' + String(mon).padStart(2, '0') + '-' + String(day).padStart(2, '0'));
      }
    }
    return out.sort();
  }
  // 기준금리 변경 이력 (오래된 순) — 한은: [{d, v}], 연준: [{d, lo, hi}]
  async function fetchKrHist() {
    var r = await fetchPage('https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643');
    var cells = [], re = /<td[^>]*>\s*([^<]*?)\s*<\/td>/g, m, out = [];
    while ((m = re.exec(r.body))) cells.push(m[1]);
    for (var i = 0; i + 2 < cells.length; i++) {
      var dm = /^(\d{1,2})월\s*(\d{1,2})일$/.exec(cells[i + 1]);
      if (/^\d{4}$/.test(cells[i]) && dm && /^\d+(\.\d+)?$/.test(cells[i + 2])) {
        out.push({ d: cells[i] + '-' + dm[1].padStart(2, '0') + '-' + dm[2].padStart(2, '0'), v: parseFloat(cells[i + 2]) });
        i += 2;
      }
    }
    return out.sort(function(a, b){ return a.d < b.d ? -1 : 1; });
  }
  async function fetchUsHist() {
    var r = await fetchPage('https://www.federalreserve.gov/monetarypolicy/openmarket.htm');
    var months = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 };
    var out = [], sections = r.body.split(/<h4>(\d{4})<\/h4>/);
    for (var s = 1; s + 1 < sections.length; s += 2) {
      (sections[s + 1].split('</table>')[0].match(/<tr>[\s\S]*?<\/tr>/g) || []).forEach(function(row) {
        var tds = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(function(td){ return td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(); });
        if (tds.length < 4) return;
        var dm = /^([A-Za-z]+)\s+(\d{1,2})/.exec(tds[0]), lv = /^([\d.]+)(?:\s*-\s*([\d.]+))?/.exec(tds[3]);
        if (!dm || !months[dm[1]] || !lv) return;
        out.push({ d: sections[s] + '-' + String(months[dm[1]]).padStart(2, '0') + '-' + dm[2].padStart(2, '0'),
          lo: parseFloat(lv[1]), hi: lv[2] != null ? parseFloat(lv[2]) : parseFloat(lv[1]) });
      });
    }
    return out.sort(function(a, b){ return a.d < b.d ? -1 : 1; });
  }
  function rateVal(h, bank) { return bank === 'kr' ? h.v.toFixed(2) + '%' : (h.lo === h.hi ? h.hi.toFixed(2) : h.lo.toFixed(2) + '~' + h.hi.toFixed(2)) + '%'; }
  // 최근 변경 3번: '24.11 ▼0.25 → 25.02 ▼0.25 → 25.05 ▼0.25 (현재 2.50%)'
  function trendText(hist, bank) {
    if (!hist || !hist.length) return '';
    var last = hist.slice(-4), parts = [];
    for (var i = 1; i < last.length; i++) {
      var diff = bank === 'kr' ? last[i].v - last[i - 1].v : last[i].hi - last[i - 1].hi;
      parts.push(last[i].d.slice(2, 4) + '.' + last[i].d.slice(5, 7) + ' ' + arrow(diff) + Math.abs(diff).toFixed(2));
    }
    return parts.join(' → ') + ' (현재 ' + rateVal(hist[hist.length - 1], bank) + ')';
  }
  function lastChangeText(hist) {
    if (!hist || !hist.length) return '';
    var dt = hist[hist.length - 1].d, months = Math.round(dayDiff(kstDate(0), dt) / 30.4);
    return dt.replace(/-/g, '.') + (months > 0 ? ' (' + months + '개월 전)' : '');
  }
  function histBefore(hist, ymd) { var h = (hist || []).filter(function(x){ return x.d < ymd; }); return h.length ? h[h.length - 1] : null; }
  async function policyHist() {
    return (await cachedDaily('bot_policy_hist', async function() {
      var kr = await fetchKrHist().catch(function(){ return []; }), us = await fetchUsHist().catch(function(){ return []; });
      return kr.length || us.length ? { kr: kr, us: us } : null;
    })) || { kr: [], us: [] };
  }
  async function bokMeetings() { return (await cachedDaily('bot_bok_meetings', fetchBokMeetings)) || []; }
  async function fomcDates() { return (await cachedDaily('bot_fomc_dates', fetchFomcDates)) || []; }
  // 뉴욕 시간대 오프셋 (EDT -4 / EST -5)
  function nyOffset(ymd) {
    var t = new Date(ymd + 'T12:00:00Z');
    return Math.round((new Date(t.toLocaleString('en-US', { timeZone: 'America/New_York' })) - new Date(t.toLocaleString('en-US', { timeZone: 'UTC' }))) / 3600000);
  }
  // FOMC 결정(14:00 ET)은 한국시간 다음날 새벽
  function fomcKst(ymd) { return { date: addDays(ymd, 1), hour: 14 - nyOffset(ymd) + 9 - 24 }; }

  // 한국은행: 금통위 당일 09:30~11:30 KST에 연합뉴스 속보 제목으로 결과 감지
  async function krDecisionFromNews(today) {
    var r = await fetchPage('https://www.yna.co.kr/rss/news.xml');
    if (r.status !== 200) throw new Error('연합뉴스 RSS ' + r.status);
    return (r.body.match(/<item>[\s\S]*?<\/item>/g) || []).map(function(x) {
      return {
        title: ((x.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || [])[1] || '').trim(),
        link: ((x.match(/<link><!\[CDATA\[([\s\S]*?)\]\]><\/link>/) || x.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim(),
        pub: new Date(((x.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim()),
      };
    }).filter(function(it) {
      return /기준금리/.test(it.title) && /동결|인상|인하/.test(it.title) && !isNaN(it.pub) &&
        new Date(it.pub.getTime() + 9 * 3600000).toISOString().slice(0, 10) === today;
    }).sort(function(a, b){ return a.pub - b.pub; })[0] || null;
  }
  function krResultVars(hit, hist, today) {
    var dec = /동결/.test(hit.title) ? '동결' : /인상/.test(hit.title) ? '인상' : '인하';
    var rm = hit.title.match(/연\s*([\d.]+)\s*%/) || hit.title.match(/([\d]+\.\d+)\s*%/);
    var prev = histBefore(hist, today), v = Object.assign(emptyVars('rate_kr', 'result'), { 결정: dec, 제목: hit.title, 링크: hit.link });
    if (rm) v.금리 = parseFloat(rm[1]).toFixed(2) + '%';
    if (prev) {
      v.이전금리 = prev.v.toFixed(2) + '%';
      if (rm && dec !== '동결') v.변동폭 = signed(parseFloat(rm[1]) - prev.v, 2, '%p');
    }
    v.추세 = trendText(hist, 'kr'); v.마지막변경 = lastChangeText(hist);
    return v;
  }

  // 연준: FOMC 결정일 13:55~16:00 ET 동안 연준 보도자료 RSS에서 성명서를 찾아 금리 결정을 읽음
  async function latestFomcStatement(maxAgeMs) {
    var r = await fetchPage('https://www.federalreserve.gov/feeds/press_monetary.xml');
    if (r.status !== 200) throw new Error('Fed RSS ' + r.status);
    var item = (r.body.match(/<item>[\s\S]*?<\/item>/g) || []).find(function(x){ return /issues FOMC statement/.test(x); });
    if (!item) return null;
    var link = ((item.match(/<link><!\[CDATA\[(.*?)\]\]><\/link>/) || [])[1] || '').trim();
    var pub = new Date(((item.match(/<pubDate><!\[CDATA\[(.*?)\]\]><\/pubDate>/) || [])[1] || '').trim());
    if (!link || isNaN(pub) || (maxAgeMs && Date.now() - pub.getTime() > maxAgeMs)) return null;
    var page = await fetchPage(link);
    var text = page.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    var m = text.match(/decided to (maintain|raise|lower) the target range for the federal funds rate (?:by ([\d\/]+) percentage point )?(?:at|to) ([\d\-\/]+ to [\d\-\/]+) percent/);
    return { link: link, pub: pub, m: m };
  }
  // 연준 표기 '3-3/4', '1/4' → 3.75, 0.25
  function frac(s) { var f = s.match(/^(?:(\d+)-)?(\d+)\/(\d+)$/); return f ? (+(f[1] || 0)) + f[2] / f[3] : parseFloat(s); }
  function fedResultVars(st, hist) {
    var VERB = { maintain: '동결', raise: '인상', lower: '인하' };
    var v = Object.assign(emptyVars('rate_us', 'result'), { 제목: 'FOMC 성명', 링크: st.link });
    if (st.m) {
      v.결정 = VERB[st.m[1]];
      v.금리 = st.m[3].split(' to ').map(function(x){ return frac(x).toFixed(2); }).join('~') + '%';
      if (st.m[2]) v.변동폭 = (st.m[1] === 'lower' ? '-' : '+') + frac(st.m[2]).toFixed(2) + '%p';
    } else v.결정 = '발표';
    var pubDay = new Date(st.pub.getTime() - 5 * 3600000).toISOString().slice(0, 10), prev = histBefore(hist, pubDay);
    if (prev) v.이전금리 = rateVal(prev, 'us');
    v.추세 = trendText(hist, 'us'); v.마지막변경 = lastChangeText(hist);
    return v;
  }

  function previewVars(bank, meetingLabel, dd, hist) {
    var cur = hist && hist.length ? hist[hist.length - 1] : null;
    return { 회의일: meetingLabel, D데이: dd === 0 ? '오늘' : 'D-' + dd, 현재금리: cur ? rateVal(cur, bank) : '', 추세: trendText(hist, bank), 마지막변경: lastChangeText(hist) };
  }

  async function stepRateKr(S) {
    var R = S.rate_kr;
    if (!R.enabled) return 'off';
    var k = kst(), today = kstDate(0), mins = k.getUTCHours() * 60 + k.getUTCMinutes(), out = {};
    var meetings = await bokMeetings();
    // 회의 전 예고
    if (k.getUTCHours() >= (R.timing.hour != null ? R.timing.hour : 8)) {
      for (var dt of meetings) {
        var dd = dayDiff(dt, today);
        if (dd < 0 || (R.timing.before || []).indexOf(dd) < 0) continue;
        var key = 'ratepre:KR:' + dt + ':' + dd;
        if (await logged(key)) continue;
        var hist = (await policyHist()).kr;
        out.preview = await deliver('rate_kr', key, render(R.templates.preview, previewVars('kr', md(dt) + ' 오전 10시경', dd, hist)), '금통위 D-' + dd);
      }
    }
    // 결정 즉시
    if (R.timing.result && meetings.indexOf(today) >= 0 && mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30 && !(await logged('rate:KR:' + today))) {
      var hit = await krDecisionFromNews(today);
      out.result = hit ? await deliver('rate_kr', 'rate:KR:' + today, render(R.templates.result, krResultVars(hit, (await policyHist()).kr, today)), '한은 기준금리 ' + hit.title) : 'waiting';
    }
    return Object.keys(out).length ? out : 'idle';
  }

  async function stepRateUs(S) {
    var R = S.rate_us;
    if (!R.enabled) return 'off';
    var k = kst(), today = kstDate(0), out = {};
    var dates = await fomcDates();
    if (k.getUTCHours() >= (R.timing.hour != null ? R.timing.hour : 8)) {
      for (var dt of dates) {
        var fk = fomcKst(dt), dd = dayDiff(fk.date, today);
        if (dd < 0 || (R.timing.before || []).indexOf(dd) < 0) continue;
        var key = 'ratepre:US:' + dt + ':' + dd;
        if (await logged(key)) continue;
        var label = md(dt) + ' 14:00 ET (한국 ' + md(fk.date) + ' 새벽 ' + fk.hour + '시)';
        out.preview = await deliver('rate_us', key, render(R.templates.preview, previewVars('us', label, dd, (await policyHist()).us)), 'FOMC D-' + dd);
      }
    }
    if (R.timing.result) {
      var et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })), etToday = etDate();
      var mins = et.getHours() * 60 + et.getMinutes();
      var isDay = dates.length ? dates.indexOf(etToday) >= 0 : et.getDay() === 3;
      if (isDay && mins >= 13 * 60 + 55 && mins <= 16 * 60 && !(await logged('rate:US:' + etToday))) {
        var st = await latestFomcStatement(3 * 3600000);
        out.result = st ? await deliver('rate_us', 'rate:US:' + etToday, render(R.templates.result, fedResultVars(st, (await policyHist()).us)), '연준 기준금리 결정') : 'waiting';
      }
    }
    return Object.keys(out).length ? out : 'idle';
  }

  // ════════════ 아침 브리핑 ════════════
  function quoteLine(it, q) {
    if (!q || q.v == null) return it.label + '  조회 실패';
    var k = it.kind, v = q.v, fxDigits = v >= 100 ? 1 : 2;
    var chg = function(base) {
      if (base == null) return '';
      if (k === 'yield') { var bp = Math.round((v - base) * 100); return arrow(bp) + Math.abs(bp) + 'bp'; }
      if (k === 'fx') { var dlt = v - base; return arrow(dlt) + Math.abs(dlt).toFixed(fxDigits); }
      var pct = (v - base) / base * 100; return arrow(pct) + Math.abs(pct).toFixed(2) + '%';
    };
    var digits = k === 'fx' ? fxDigits : 2;
    var s = it.label + '  **' + (k === 'yield' ? v.toFixed(2) + '%' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })) + '**';
    var c1 = chg(q.prev); if (c1) s += '  ' + c1;
    if (it.show_trend) { var c2 = chg(q.first); if (c2) s += ' · 1개월 ' + c2; }
    return s;
  }
  async function marketBlock() {
    var items = await sel('bot_brief_items?select=*&enabled=eq.true&order=sort_order.asc,created_at.asc');
    if (!items.length) return '';
    var qs = await Promise.allSettled(items.map(function(it){ return yahooChart(it.symbol); }));
    return '📈 **시장 지표**\n' + items.map(function(it, i){ return quoteLine(it, qs[i].status === 'fulfilled' ? qs[i].value : null); }).join('\n');
  }
  async function econBlock() {
    var r = await d.getFF('https://nfs.faireconomy.media/ff_calendar_thisweek.json?timezone=Asia/Seoul');
    if (r.status !== 200) return '';
    var today = kstDate(0), FLAG = { USD: '🇺🇸', JPY: '🇯🇵', CNY: '🇨🇳', EUR: '🇪🇺' };
    var evs = parseJson(r.body, []).map(d.normalizeFFEvent).filter(function(ev) {
      return ev.impact === 'High' && FLAG[ev.currency] && ev.date && new Date(new Date(ev.date).getTime() + 9 * 3600000).toISOString().slice(0, 10) === today;
    }).sort(function(a, b){ return new Date(a.date) - new Date(b.date); });
    if (!evs.length) return '';
    return '📅 **오늘 주요 경제지표 (KST)**\n' + evs.map(function(ev) {
      return (ev.time || '시간 미정') + ' ' + FLAG[ev.currency] + ' ' + d.translateTitle(ev.title) + (ev.forecast ? ' (예측 ' + ev.forecast + ')' : '');
    }).join('\n');
  }
  function earningsBlock(companies) {
    var today = kstDate(0), lines = [];
    companies.forEach(function(c) {
      var ev = c.alert_earnings && earningsKst(c);
      if (!ev) return;
      var dd = dayDiff(ev.date, today);
      if (dd === 0 || dd === 1) lines.push((dd === 0 ? '오늘' : '내일') + ' · ' + c.name + ' (' + c.ticker + ')' + (ev.label ? ' ' + ev.label : ''));
    });
    return lines.length ? '📊 **관심 기업 실적 발표**\n' + lines.join('\n') : '';
  }
  async function ratesBlock() {
    var today = kstDate(0), lines = [];
    (await bokMeetings()).forEach(function(dt) {
      var dd = dayDiff(dt, today);
      if (dd >= 0 && dd <= 7) lines.push((dd === 0 ? '오늘' : 'D-' + dd) + ' 🇰🇷 금통위 ' + md(dt));
    });
    (await fomcDates()).forEach(function(dt) {
      var fk = fomcKst(dt), dd = dayDiff(fk.date, today);
      if (dd >= 0 && dd <= 7) lines.push((dd === 0 ? '오늘' : 'D-' + dd) + ' 🇺🇸 FOMC ' + md(fk.date) + ' 새벽 ' + fk.hour + '시 발표');
    });
    return lines.length ? '🏦 **금리 결정 일정**\n' + lines.join('\n') : '';
  }
  async function yesterdayDiscBlock() {
    var from = new Date(kstDate(-1) + 'T00:00:00+09:00').toISOString(), to = new Date(kstDate(0) + 'T00:00:00+09:00').toISOString();
    var rows = await sel('bot_message_log?select=title&alert_type=eq.disclosure&created_at=gte.' + enc(from) + '&created_at=lt.' + enc(to) + '&order=created_at.asc');
    if (!rows.length) return '';
    return '📢 **어제 관심 기업 공시 ' + rows.length + '건**\n' + rows.slice(0, 8).map(function(r){ return '• ' + (r.title || ''); }).join('\n') + (rows.length > 8 ? '\n외 ' + (rows.length - 8) + '건' : '');
  }
  async function briefVars(B, companies) {
    var blocks = B.options.blocks || [], v = emptyVars('morning_brief');
    v.날짜 = md(kstDate(0));
    var jobs = [];
    var put = function(key, p) { jobs.push(Promise.resolve(p).then(function(s){ v[key] = s || ''; }).catch(function(){})); };
    if (blocks.indexOf('market') >= 0) put('시장지표', marketBlock());
    if (blocks.indexOf('econ') >= 0) put('경제지표', econBlock());
    if (blocks.indexOf('earnings') >= 0) put('실적발표', earningsBlock(companies));
    if (blocks.indexOf('rates') >= 0) put('금리일정', ratesBlock());
    if (blocks.indexOf('disclosures') >= 0) put('어제공시', yesterdayDiscBlock());
    await Promise.all(jobs);
    return v;
  }
  async function stepBrief(S, companies) {
    var B = S.morning_brief;
    if (!B.enabled) return 'off';
    var k = kst();
    if ((B.timing.days || []).indexOf(k.getUTCDay()) < 0) return 'not today';
    if (k.getUTCHours() < (B.timing.hour != null ? B.timing.hour : 8)) return 'wait';
    var key = 'brief:' + kstDate(0);
    if (await logged(key)) return 'done';
    return (await deliver('morning_brief', key, render(B.templates.main, await briefVars(B, companies)), '아침 브리핑')) ? 'sent' : 'not sent';
  }

  // 공시 '하루 한 번 모아서' 모드: 정한 시각에 대기열을 한 메시지로
  async function stepDigest(S) {
    var D = S.disclosure;
    if (!D.enabled || D.timing.mode !== 'digest') return 'off';
    if (kst().getUTCHours() < (D.timing.digest_hour != null ? D.timing.digest_hour : 18)) return 'wait';
    var key = 'digest:' + kstDate(0);
    if (await logged(key)) return 'done';
    var queued = await sel('bot_message_log?select=id,text&alert_type=eq.disclosure&status=eq.queued&order=created_at.asc');
    if (!queued.length) return 'empty';
    var text = '📢 <b>관심 기업 공시 모아보기</b> (' + queued.length + '건)\n\n' + queued.map(function(q){ return q.text; }).join('\n\n');
    if (!(await deliver('disclosure_digest', key, text, '공시 모아보기 ' + queued.length + '건'))) return 'not sent';
    await patch('bot_message_log', 'id=in.(' + queued.map(function(q){ return q.id; }).join(',') + ')', { status: 'sent' });
    return { sent: queued.length };
  }

  // ════════════ API 핸들러 ════════════
  async function handleTick(req, res) {
    // 누가 주소를 반복 호출해도 외부 API 한도를 소모하지 않도록 40초 내 재실행은 건너뜀
    var last = Number(await d.getSetting('tick_at') || 0);
    if (Date.now() - last < 40000) return res.json({ skipped: true });
    await d.setSetting('tick_at', String(Date.now()));

    var S = await loadSettings(), companies = await loadCompanies(), out = {};
    var run = async function(name, fn) { try { out[name] = await fn(); } catch(e) { out[name] = 'error: ' + e.message; } };
    // 실적일 갱신·SEC(실적 8-K 표시)가 회사 상태를 바꾸므로 먼저 순서대로, 나머지는 병렬
    await run('refresh', function(){ return stepRefresh(companies); });
    await run('sec', function(){ return stepSecUS(S, companies); });
    await Promise.all([
      run('dart', function(){ return stepDartKR(S, companies); }),
      run('us_results', function(){ return stepUsResults(S, companies); }),
      run('schedule', function(){ return stepSchedule(S, companies); }),
      run('rate_kr', function(){ return stepRateKr(S); }),
      run('rate_us', function(){ return stepRateUs(S); }),
      run('brief', function(){ return stepBrief(S, companies); }),
      run('digest', function(){ return stepDigest(S); }),
    ]);
    res.json(out);
  }

  // 봇에게 마지막으로 메시지를 보낸 대화방을 알림 수신처로 저장. 이미 연결돼 있으면 ?secret=CRON_SECRET 있어야 변경 가능
  async function handleTelegramSetup(req, res) {
    if (!process.env.TELEGRAM_BOT_TOKEN) return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN 환경변수 없음' });
    var existing = await d.getSetting('telegram_chat_id'), secret = process.env.CRON_SECRET;
    if (existing && secret && req.query.secret !== secret) {
      return res.status(403).json({ error: '이미 연결되어 있어요' });
    }
    var up = await tgApi('getUpdates', { allowed_updates: ['message'] });
    if (!up.ok) return res.status(502).json({ error: 'getUpdates 실패: ' + (up.description || '') });
    var msgs = (up.result || []).map(function(u){ return u.message; }).filter(function(m){ return m && m.chat; });
    if (!msgs.length) return res.status(400).json({ error: '텔레그램에서 봇에게 아무 메시지나 먼저 보내주세요' });
    var chat = msgs[msgs.length - 1].chat, name = chat.first_name || chat.title || String(chat.id);
    await d.setSetting('telegram_chat_id', String(chat.id));
    await d.setSetting('telegram_chat_name', name);
    var ok = await sendTelegram('✅ <b>식식징구 알림 연결 완료</b>\n\n앞으로 이 대화방으로 보내드릴게요. 받을 알림은 홈페이지 [봇 설정]에서 고를 수 있어요.');
    res.json({ ok: ok, chat: name });
  }

  function handleMeta(req, res) {
    res.json({ meta: META, categories: CAT_KO, blocks: BLOCKS, presets: PRESETS, telegram: !!process.env.TELEGRAM_BOT_TOKEN });
  }

  // 관심 기업 검색 — 국내: 네이버 자동완성 + DART 고유번호 / 미국: SEC 티커 목록 (CIK)
  var _secMap = { at: 0, list: null };
  async function secTickers() {
    if (_secMap.list && Date.now() - _secMap.at < 86400000) return _secMap.list;
    var r = await d.httpsGetRaw('www.sec.gov', '/files/company_tickers.json', { 'User-Agent': SEC_UA });
    var j = parseJson(r.body, null);
    if (!j) throw new Error('SEC 티커 목록 조회 실패 (HTTP ' + r.status + ')');
    _secMap = { at: Date.now(), list: Object.keys(j).map(function(k){ return { ticker: j[k].ticker, name: j[k].title, cik: String(j[k].cik_str) }; }) };
    return _secMap.list;
  }
  async function handleSearch(req, res) {
    var q = String(req.query.q || '').trim(), market = req.query.market === 'US' ? 'US' : 'KR';
    if (!q) return res.json({ results: [] });
    try {
      if (market === 'KR') {
        var nr = await d.naverSearchGet(q), map = await d.getDartStockCodeMap();
        var items = (parseJson(nr.body, {}).items || []).filter(function(it){ return it.category === 'stock' && it.nationCode === 'KOR'; }).slice(0, 8);
        return res.json({ results: items.map(function(it) {
          var dm = map[it.code];
          return { market: 'KR', ticker: it.code, name: it.name, sub: it.typeName || it.typeCode, corp_code: dm ? dm.corpCode : null,
            cik: null, yahoo_symbol: it.code + (it.typeCode === 'KOSDAQ' ? '.KQ' : '.KS') };
        }) });
      }
      var list = await secTickers(), Q = q.toUpperCase();
      var score = function(x) { return x.ticker === Q ? 0 : x.ticker.indexOf(Q) === 0 ? 1 : x.name.toUpperCase().indexOf(Q) === 0 ? 2 : x.name.toUpperCase().indexOf(Q) >= 0 ? 3 : 9; };
      var hits = list.map(function(x){ return { x: x, s: score(x) }; }).filter(function(h){ return h.s < 9; })
        .sort(function(a, b){ return a.s - b.s || a.x.ticker.length - b.x.ticker.length; }).slice(0, 8);
      res.json({ results: hits.map(function(h) {
        return { market: 'US', ticker: h.x.ticker, name: h.x.name, sub: 'CIK ' + h.x.cik, corp_code: null, cik: h.x.cik, yahoo_symbol: h.x.ticker.replace(/\./g, '-') };
      }) });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }

  async function handleQuote(req, res) {
    var symbol = String(req.query.symbol || '').trim();
    if (!symbol) return res.status(400).json({ error: 'symbol 필요' });
    try { var q = await yahooChart(symbol); res.json({ ok: q.v != null, name: q.name, price: q.v, currency: q.currency }); }
    catch(e) { res.json({ ok: false, error: '찾을 수 없는 심볼이에요 (' + e.message + ')' }); }
  }

  // 미리보기용 실제 데이터 — 관심 기업의 가장 최근 공시/실적, 최근 금리 결정 등으로 템플릿을 채운다
  async function sampleVars(type, key, S, companies) {
    if (type === 'morning_brief') return { vars: await briefVars(S.morning_brief, companies), note: '지금 시점의 실제 데이터예요' };
    if (type === 'disclosure') {
      for (var c of companies) {
        if (c.market === 'KR' && c.corp_code) {
          var lr = await d.dartGetJson('/api/list.json?crtfc_key=' + enc(d.dartKey()) + '&corp_code=' + c.corp_code + '&bgn_de=' + kstDate(-180).replace(/-/g, '') + '&end_de=' + kstDate(0).replace(/-/g, '') + '&page_count=1');
          var it = (parseJson(lr.body, {}).list || [])[0];
          if (!it) continue;
          var nm = it.report_nm.replace(/\s+/g, ' ').trim();
          return { note: c.name + '의 가장 최근 공시로 만든 미리보기예요', vars: { 회사명: c.name, 티커: c.ticker, 시장: '국내', 분류: CAT_KO[classifyKR(nm)], 공시명: nm,
            시각: md(it.rcept_dt.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')), 링크: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + it.rcept_no } };
        }
        if (c.market === 'US' && c.cik) {
          var sr = await d.httpsGetRaw('data.sec.gov', '/submissions/CIK' + String(c.cik).padStart(10, '0') + '.json', { 'User-Agent': SEC_UA });
          var rec = (parseJson(sr.body, {}).filings || {}).recent;
          if (!rec || !rec.form || !rec.form.length) continue;
          var items = (rec.items[0] || '').split(',').filter(Boolean), acc = rec.accessionNumber[0];
          return { note: c.name + '의 가장 최근 공시로 만든 미리보기예요', vars: { 회사명: c.name, 티커: c.ticker, 시장: '미국', 분류: CAT_KO[classifyUS(rec.form[0], items)],
            공시명: usTitle(rec.form[0], items), 시각: md(rec.filingDate[0]),
            링크: 'https://www.sec.gov/Archives/edgar/data/' + c.cik + '/' + acc.replace(/-/g, '') + '/' + acc + '-index.htm' } };
        }
      }
      return { note: '관심 기업을 먼저 추가해 주세요' };
    }
    if (type === 'earnings_result') {
      for (var c2 of companies) {
        if (c2.market === 'KR' && c2.corp_code) {
          var lr2 = await d.dartGetJson('/api/list.json?crtfc_key=' + enc(d.dartKey()) + '&corp_code=' + c2.corp_code + '&bgn_de=' + kstDate(-365).replace(/-/g, '') + '&end_de=' + kstDate(0).replace(/-/g, '') + '&page_count=100');
          var rep = (parseJson(lr2.body, {}).list || []).find(function(x){ return isKrEarningsReport(x.report_nm.replace(/\s+/g, ' ').trim()); });
          if (!rep) continue;
          var ev = await krEarningsVars(c2, rep.rcept_no, rep.report_nm.replace(/\s+/g, ' ').trim(), 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + rep.rcept_no);
          if (ev) return { vars: ev, note: c2.name + '의 가장 최근 실적 공시로 만든 미리보기예요' };
        }
        if (c2.market === 'US' && c2.yahoo_symbol) {
          var ys = await yahooSummary(c2.yahoo_symbol, 'earnings,earningsHistory'), st = Object.assign({}, c2.state || {}), hist = mergeHist(st, ys);
          if (hist.length) return { vars: usResultVars(c2, hist[hist.length - 1], ys, st), note: c2.name + '의 가장 최근 분기 실적으로 만든 미리보기예요' };
        }
      }
      return { note: '실적을 받을 관심 기업을 먼저 추가해 주세요' };
    }
    if (type === 'earnings_schedule') {
      var today = kstDate(0);
      var up = companies.filter(function(c){ var ev = earningsKst(c); return ev && ev.date >= today; })
        .sort(function(a, b){ return earningsKst(a).date < earningsKst(b).date ? -1 : 1; })[0];
      if (!up) return { note: '다음 실적 발표일이 확인된 관심 기업이 없어요 (기업 추가 후 1~2분 뒤 다시 시도)' };
      return { vars: scheduleVars(up, dayDiff(earningsKst(up).date, today)), note: up.name + '의 다음 실적 발표일로 만든 미리보기예요' };
    }
    if (type === 'rate_kr' || type === 'rate_us') {
      var bank = type === 'rate_kr' ? 'kr' : 'us', hist2 = (await policyHist())[bank], today2 = kstDate(0);
      if (key === 'preview') {
        if (bank === 'kr') {
          var next = (await bokMeetings()).find(function(x){ return x >= today2; });
          if (!next) return { note: '올해 남은 금통위 일정이 없어요' };
          return { vars: previewVars('kr', md(next) + ' 오전 10시경', dayDiff(next, today2), hist2), note: '다음 금통위(' + md(next) + ') 기준 미리보기예요' };
        }
        var nf = (await fomcDates()).find(function(x){ return fomcKst(x).date >= today2; });
        if (!nf) return { note: '예정된 FOMC 일정을 찾지 못했어요' };
        var fk = fomcKst(nf);
        return { vars: previewVars('us', md(nf) + ' 14:00 ET (한국 ' + md(fk.date) + ' 새벽 ' + fk.hour + '시)', dayDiff(fk.date, today2), hist2), note: '다음 FOMC(' + md(nf) + ') 기준 미리보기예요' };
      }
      if (bank === 'us') {
        var st2 = await latestFomcStatement(0);
        if (!st2) return { note: '최근 FOMC 성명을 찾지 못했어요' };
        return { vars: fedResultVars(st2, hist2), note: '가장 최근 FOMC 결정으로 만든 미리보기예요' };
      }
      // 한은: 마지막 금통위 결정을 기준금리 이력으로 재구성
      var lastMeet = (await bokMeetings()).filter(function(x){ return x <= today2; }).pop();
      if (!lastMeet || !hist2.length) return { note: '최근 금통위 데이터를 찾지 못했어요' };
      var cur = hist2[hist2.length - 1], changed = cur.d === lastMeet, prev = changed ? histBefore(hist2, lastMeet) : null;
      var dec = !changed ? '동결' : prev && cur.v > prev.v ? '인상' : '인하';
      return { note: '최근 금통위(' + md(lastMeet) + ') 결정으로 만든 미리보기예요', vars: Object.assign(emptyVars('rate_kr', 'result'), {
        결정: dec, 금리: cur.v.toFixed(2) + '%', 변동폭: changed && prev ? signed(cur.v - prev.v, 2, '%p') : '', 이전금리: prev ? prev.v.toFixed(2) + '%' : '',
        추세: trendText(hist2, 'kr'), 마지막변경: lastChangeText(hist2), 제목: '한은 기준금리 ' + dec, 링크: 'https://www.bok.or.kr/portal/singl/baseRate/list.do?dataSeCd=01&menuNo=200643' }) };
    }
    return { note: '알 수 없는 알림 종류' };
  }

  async function handlePreview(req, res) {
    var b = req.body || {}, type = b.type, key = b.key || 'main';
    if (!META[type] || !META[type].templates[key]) return res.status(400).json({ error: '알 수 없는 알림 종류' });
    try {
      var S = await loadSettings(), companies = await loadCompanies();
      var r = await sampleVars(type, key, S, companies);
      if (!r.vars) return res.json({ ok: false, note: r.note });
      var tpl = b.template != null ? b.template : S[type].templates[key];
      var html = type === 'earnings_result' ? await renderEarnings(tpl, r.vars) : render(tpl, r.vars);
      var sent = b.send ? await sendTelegram(html) : null;
      res.json({ ok: true, html: html, note: r.note, sent: sent });
    } catch(e) { res.status(500).json({ error: e.message }); }
  }

  return { handleTick: handleTick, handleTelegramSetup: handleTelegramSetup, handleMeta: handleMeta, handleSearch: handleSearch,
    handleQuote: handleQuote, handlePreview: handlePreview, render: render, _test: { parseProvisional: parseProvisional, naverConsensus: naverConsensus,
      krEarningsVars: krEarningsVars, fetchFomcDates: fetchFomcDates, fetchKrHist: fetchKrHist, fetchUsHist: fetchUsHist, secLatest: secLatest,
      yahooChart: yahooChart, quoteLine: quoteLine, renderEarnings: renderEarnings, sampleVars: sampleVars, fomcKst: fomcKst, trendText: trendText } };
};
