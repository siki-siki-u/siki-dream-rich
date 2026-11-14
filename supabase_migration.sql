-- ============================================================
-- siki-dream-rich Supabase migration
-- Supabase 대시보드 > SQL Editor 에서 실행하세요
-- ============================================================

-- 1. portfolio_holdings
create table if not exists portfolio_holdings (
  id          bigint primary key,
  ticker      text not null default '',
  name        text not null default '',
  type        text not null default 'US',
  owner       text not null default '윤식',
  is_direct   boolean not null default false,
  current_krw bigint not null default 0,
  invested_krw bigint not null default 0,
  qty         float not null default 0,
  added_at    text not null default '',
  created_at  timestamptz default now()
);

-- 2. portfolio_snapshots
create table if not exists portfolio_snapshots (
  date             text primary key,
  invested_krw     bigint not null default 0,
  value_krw        bigint not null default 0,
  volatile_inv_krw bigint not null default 0,
  volatile_val_krw bigint not null default 0,
  locked_inv_krw   bigint not null default 0,
  locked_val_krw   bigint not null default 0,
  fixed_inv_krw    bigint not null default 0,
  fixed_val_krw    bigint not null default 0,
  holdings         jsonb not null default '[]',
  saved_at         timestamptz default now()
);

-- 3. home_goal_price 는 기존 settings 테이블 사용 (별도 테이블 불필요)
--    INSERT를 실행할 필요 없음, 앱에서 저장 버튼 누르면 자동 upsert 됨

-- 3. mock_investments (모의 투자)
create table if not exists mock_investments (
  id               uuid primary key default gen_random_uuid(),
  invest_date      date not null,
  symbol           text not null,
  name             text not null default '',
  asset_type       text not null default 'US',
  currency         text not null default 'USD',
  quantity         numeric not null default 0,
  price_at_invest  numeric not null default 0,
  invest_amount_krw bigint not null default 0,
  reason           text not null default '',
  note             text not null default '',
  created_at       timestamptz default now()
);

-- 4. invest_terms (투자 용어 사전)
create table if not exists invest_terms (
  id         uuid primary key default gen_random_uuid(),
  term       text not null,
  meaning    text not null,
  created_at timestamptz default now()
);

-- 5. stock_notes (종목 분석 노트)
create table if not exists stock_notes (
  id               text primary key,
  ticker           text not null default '',
  name             text not null default '',
  market           text not null default 'US',
  status           text not null default 'watching',
  fair_value       numeric,
  target_buy_price numeric,
  opinion          text not null default '',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 6. realized_profits (익절 기록)
create table if not exists realized_profits (
  id          text primary key,
  date        text not null,
  amount      bigint not null default 0,
  ticker      text not null default '',
  note        text not null default '',
  created_at  timestamptz default now()
);

-- 7. push_subscriptions (Web Push 구독 정보)
create table if not exists push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
);

-- 8. sector_map_stocks (토스증권 API 테스트 — 섹터맵 종목 매핑)
create table if not exists sector_map_stocks (
  id         uuid primary key default gen_random_uuid(),
  symbol     text not null,
  name       text not null default '',
  market     text not null default 'KOSPI',
  theme      text not null,
  created_at timestamptz default now(),
  unique(symbol, theme)
);

-- 9. investment_records (투자 기록 — 매수/매도 추적)
create table if not exists investment_records (
  id           uuid primary key default gen_random_uuid(),
  ticker       text not null,
  name         text not null default '',
  market       text not null default 'US',
  status       text not null default 'holding',
  target_price numeric,
  buy_price    numeric not null,
  quantity     numeric not null default 1,
  buy_date     date not null,
  sell_price   numeric,
  sell_date    date,
  note         text not null default '',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 이미 investment_records를 만드셨다면 이 줄만 추가로 실행하세요:
-- alter table investment_records add column if not exists quantity numeric not null default 1;

-- 10. compound_goals (투자 평가 — 복리 계산기 저장 목표)
create table if not exists compound_goals (
  id             uuid primary key default gen_random_uuid(),
  label          text not null default '',
  initial_amount bigint not null check (initial_amount > 0),
  monthly_contribution bigint not null default 0 check (monthly_contribution between 0 and 10000000000),
  annual_rate    numeric not null check (annual_rate between -50 and 100),
  years          int not null check (years between 1 and 100),
  created_at     timestamptz default now()
);

-- 이미 compound_goals를 만드셨다면 이 줄만 추가로 실행하세요 (월 추가 투자금):
-- alter table compound_goals add column if not exists monthly_contribution bigint not null default 0 check (monthly_contribution between 0 and 10000000000);

-- RLS (Row Level Security) 비활성화 — 퍼블릭 접근 허용
alter table portfolio_holdings  disable row level security;
alter table portfolio_snapshots disable row level security;
alter table mock_investments     disable row level security;
alter table invest_terms         disable row level security;
alter table stock_notes          disable row level security;
alter table realized_profits     disable row level security;
alter table push_subscriptions   disable row level security;
alter table sector_map_stocks    disable row level security;
alter table investment_records   disable row level security;
alter table compound_goals       disable row level security;

-- 긴급 수정: transactions(가계부) 테이블만 RLS가 켜져 있어서 모든 저장이 막혀 있었음
-- (anon 키로 insert/upsert 시 "new row violates row-level security policy" 발생 확인)
alter table transactions         disable row level security;

-- 11. dart_watchlist (DART 공시 알림 — 관심 기업의 신규 공시를 푸시로 알림)
create table if not exists dart_watchlist (
  id            uuid primary key default gen_random_uuid(),
  corp_code     text not null unique,
  corp_name     text not null,
  stock_code    text,
  notify        boolean not null default true,
  last_rcept_no text,
  created_at    timestamptz default now()
);
alter table dart_watchlist disable row level security;

-- 12. 텔레그램 실시간 알림 — 1분마다 Vercel의 tick 액션 호출 (공시/기준금리/아침 브리핑/실적 D-3·D-1)
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule(
  'siki-tick',
  '* * * * *',
  $$ select net.http_get(
       url := 'https://siki-dream-rich.vercel.app/api/economic-calendar?action=tick',
       timeout_milliseconds := 30000
     ) $$
);
-- 확인: select * from cron.job;   중지: select cron.unschedule('siki-tick');

-- 13. 봇 설정 (텔레그램 알림) — 홈페이지 [봇 설정] 페이지에서 읽고 쓰고, 1분 tick(lib/bot.js)이 이 값대로 발송
-- 알림 종류별 켜기/끄기 · 템플릿 · 받는 시점 · 옵션 (비어 있는 값은 lib/bot.js의 기본값 사용)
create table if not exists bot_alert_settings (
  alert_type text primary key,       -- disclosure | earnings_result | earnings_schedule | rate_kr | rate_us | morning_brief
  enabled    boolean not null default true,
  templates  jsonb not null default '{}',
  timing     jsonb not null default '{}',
  options    jsonb not null default '{}',
  updated_at timestamptz default now()
);

-- 관심 기업 (국내 DART + 미국 SEC)
create table if not exists bot_watch_companies (
  id               uuid primary key default gen_random_uuid(),
  market           text not null,                 -- KR | US
  ticker           text not null,
  name             text not null,
  corp_code        text,                          -- DART 고유번호 (국내)
  cik              text,                          -- SEC CIK (미국)
  yahoo_symbol     text,
  alert_disclosure boolean not null default true,
  alert_earnings   boolean not null default true,
  next_earnings    jsonb,                         -- 다음 실적일·컨센서스 (하루 한 번 자동 갱신)
  state            jsonb not null default '{}',   -- 분기 실적 이력 등 (YoY 계산용)
  created_at       timestamptz default now(),
  unique (market, ticker)
);

-- 아침 브리핑 지표 (Yahoo Finance 심볼)
create table if not exists bot_brief_items (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  symbol     text not null,
  kind       text not null default 'index',       -- yield | fx | index | price
  show_trend boolean not null default false,      -- 1개월 변화도 표시
  sort_order int not null default 0,
  enabled    boolean not null default true,
  created_at timestamptz default now()
);

-- 보낸 알림 기록 (중복 발송 방지 + 최근 알림 목록)
create table if not exists bot_message_log (
  id         bigint generated always as identity primary key,
  alert_type text not null,
  dedupe_key text not null unique,
  status     text not null default 'pending',     -- pending | sent | queued
  title      text,
  text       text,
  created_at timestamptz default now()
);
create index if not exists bot_message_log_created_idx on bot_message_log (created_at desc);

alter table bot_alert_settings  disable row level security;
alter table bot_watch_companies disable row level security;
alter table bot_brief_items     disable row level security;
alter table bot_message_log     disable row level security;

-- 기본값: 알림 6종 켜짐
insert into bot_alert_settings (alert_type) values
  ('disclosure'), ('earnings_result'), ('earnings_schedule'), ('rate_kr'), ('rate_us'), ('morning_brief')
on conflict do nothing;

-- 지금까지 아침 브리핑에 나가던 지표
insert into bot_brief_items (label, symbol, kind, sort_order)
select * from (values
  ('미국 3개월', '^IRX', 'yield', 1), ('미국 5년', '^FVX', 'yield', 2), ('미국 10년', '^TNX', 'yield', 3),
  ('미국 30년', '^TYX', 'yield', 4), ('원/달러', 'KRW=X', 'fx', 5), ('VIX', '^VIX', 'index', 6)
) as v(label, symbol, kind, sort_order)
where not exists (select 1 from bot_brief_items);

-- 오늘 아침 브리핑은 이전 버전이 이미 보냈으므로 중복 발송 방지
insert into bot_message_log (alert_type, dedupe_key, status, title)
values ('morning_brief', 'brief:' || to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD'), 'sent', '아침 브리핑')
on conflict do nothing;

-- ============================================================
-- 14. 📰 리포트 노트 (증권 리포트 분석 기록) — [리포트 노트] 페이지에서 읽음
--     로그인한 오너/멤버만 읽기, 오너만 쓰기 (게스트는 못 봄)
-- ============================================================
create table if not exists report_notes (
  id           text primary key,              -- r1, r2 ...
  report_date  text not null,                 -- 리포트 발간일 YYYY-MM-DD
  topic        text not null default '',      -- 다룬 대상 (기업명 또는 산업)
  title        text not null default '',
  companies    text[] not null default '{}',  -- 다룬 기업들 (기업별 개수 집계용)
  firm         text not null default '',      -- 증권사
  author       text not null default '',      -- 애널리스트
  signal       text not null default 'none',  -- 발간 당시 판단: good | warn | bad | none
  signal_label text not null default '',
  now_signal   text not null default 'none',  -- 지금 시점 판단
  now_label    text not null default '',
  summary      text not null default '',      -- 핵심 1~2문장
  holding_link text not null default '',      -- 내 보유 종목과의 연관
  risk         text not null default '',      -- 의구심(리스크)
  tp_stock     text,                          -- 목표주가 대상 종목
  target_price bigint,
  price_at_pub bigint,                        -- 발간 당시 주가
  score        int,                           -- 글쓴이 성향 0(보수)~100(공격)
  score_basis  text,                          -- 계산 | 추정
  score_reason text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create table if not exists report_holding_signals (
  stock      text primary key,                -- 보유 종목명
  signal     text not null default 'none',    -- good | warn | bad | none
  status     text not null default '',
  note       text not null default '',
  sort_order int not null default 0,
  updated_at timestamptz default now()
);

-- 보유 종목·평가가 담겨 있어서 RLS를 켜요: 게스트 계정은 읽기도 막힘
alter table report_notes           enable row level security;
alter table report_holding_signals enable row level security;

drop policy if exists report_notes_read  on report_notes;
drop policy if exists report_notes_write on report_notes;
create policy report_notes_read on report_notes for select to authenticated
  using (coalesce(auth.jwt()->'user_metadata'->>'role', 'guest') <> 'guest');
create policy report_notes_write on report_notes for all to authenticated
  using ((auth.jwt()->'user_metadata'->>'role') = 'owner')
  with check ((auth.jwt()->'user_metadata'->>'role') = 'owner');

drop policy if exists report_holding_signals_read  on report_holding_signals;
drop policy if exists report_holding_signals_write on report_holding_signals;
create policy report_holding_signals_read on report_holding_signals for select to authenticated
  using (coalesce(auth.jwt()->'user_metadata'->>'role', 'guest') <> 'guest');
create policy report_holding_signals_write on report_holding_signals for all to authenticated
  using ((auth.jwt()->'user_metadata'->>'role') = 'owner')
  with check ((auth.jwt()->'user_metadata'->>'role') = 'owner');

-- 지금까지 분석한 리포트 8건 + 보유 종목 신호등 (2026-11-14 기준)
insert into report_notes (id,report_date,topic,title,companies,firm,author,signal,signal_label,now_signal,now_label,summary,holding_link,risk,tp_stock,target_price,price_at_pub,score,score_basis,score_reason) values
  ('r1','2026-05-20','메모리 반도체 산업','5월 산업분석: 메모리 반도체',array['삼성전자','SK하이닉스']::text[],'개인 리서치','올랜도 킴','good','호재','good','호재 (단기 과열 경고)','AI의 다음 병목은 메모리. HBM·D램·낸드가 30년 만에 동시에 모자라고, 2028년 전까지 부족이 이어진다.','직접 보유 종목은 없어요. 반도체 업황 전체 분위기를 보는 참고 자료예요.','리포트 스스로 단기 과열을 경고했어요. 증권사가 아닌 개인 리서치예요.',null,null,null,72,'추정','''30년 만의 동시 부족''처럼 강한 낙관. 단, 단기 과열은 스스로 경고했어요.'),
  ('r2','2026-08-06','반도체 장비','반도체 장비 CapEx Speed Up!',array['삼성전자','SK하이닉스','원익IPS','테스','브이엠','유니셈','이오테크닉스','엘티씨']::text[],'신한투자증권','박현우·김예성','good','비중확대','good','비중확대','해법은 공장 증설뿐이고 증설 일정이 당겨지는 중. 장비주가 유망하고 최선호주는 원익IPS·테스.','직접 보유 종목은 없어요. 관심 장비주 목록으로 볼 수 있어요.','다룬 6종목이 전부 매수예요. 목표 PER도 시장이 뜨거웠던 두 달의 평균을 썼어요.',null,null,null,92,'추정','다룬 6종목이 전부 ''매수''. 목표 PER도 시장이 뜨거웠던 두 달의 평균을 썼어요.'),
  ('r3','2026-08-06','아이온큐','아이온큐 가이던스 상향',array['아이온큐']::text[],'미래에셋증권','김은지','warn','호재 + 부담','warn','호재 + 부담','2Q26 매출 $80.1mn(+287%), 연간 가이던스 $280~290mn로 상향, RPO $485mn. 다만 영업적자 확대와 밸류 부담.','직접 보유 종목은 없어요.','매출은 크게 늘었지만 영업적자도 커졌어요. 주가가 이미 비싸다는 부담이 있어요.',null,null,null,25,'추정','좋은 실적을 인정하면서도 적자 확대와 비싼 주가를 함께 짚었어요.'),
  ('r4','2026-08-06','알파벳','하사비스 딥마인드 CEO 사임·제프 딘 등 4인 퇴사, AI 리더십 공백 우려',array['알파벳']::text[],'대신증권','조재운','bad','단기 악재','bad','단기 악재','구글 AI 핵심 인물들이 한꺼번에 떠났고 제미나이 4는 지연. 이번 분기 실적 영향은 없지만 AI 리더십에 물음표.','직접 보유 종목은 없어요.','투자의견과 목표주가가 없어요. AI가 자동으로 만든 자료라 깊이가 얕아요.',null,null,null,8,'추정','단기 악재로 보고, 투자의견과 목표주가를 아예 내지 않았어요.'),
  ('r5','2026-08-06','HL만도','HL만도 로보틱스',array['HL만도']::text[],'BNK투자증권','이상현','good','매수','warn','주의 (3Q 영업이익 515억, 예상의 절반)','매수 유지, 목표가 71,000원. 2분기 최대 매출, 로봇 액추에이터 2027년 수주 목표.','보유 종목 HL만도를 직접 다룬 리포트예요.','리포트 뒤에 나온 3Q26 잠정 영업이익이 515억으로, 리포트 예상 1,000억의 절반이에요. 순손실도 425억이에요.','HL만도',71000,null,62,'추정','매수에 로봇 신사업 기대까지 얹었어요. 발간일 주가를 몰라 상승여력은 계산하지 못했어요.'),
  ('r6','2026-08-07','GST','GST 매수 신규',array['GST']::text[],'IBK투자증권','강민구','good','매수','good','호재 유지','매수 신규, 목표가 65,000원. 메가팹 증설 최대 수혜. 12개월 예상 EPS 3,883원 × 16.7배.','직접 보유 종목은 없어요.','메가팹 증설 일정이 늦어지면 수혜도 늦어져요.','GST',65000,46000,80,'계산','목표가 65,000원 ÷ 당시 주가 46,000원 = +41% 상승여력.'),
  ('r7','2026-10-21','GST','GST BUY 신규',array['GST']::text[],'흥국증권','최종경','good','매수','good','호재 유지 (기대치는 낮아짐)','BUY 신규, 목표가 58,000원. 상반기 매출·영업이익 +27%, 칠러 TSMC 데모 11월 마무리. 4,276원 × 13.6배.','직접 보유 종목은 없어요.','목표가가 IBK(65,000원)보다 낮아졌어요. 칠러 TSMC 데모 결과는 아직 몰라요.','GST',58000,43750,55,'계산','목표가 58,000원 ÷ 당시 주가 43,750원 = +32.6% 상승여력.'),
  ('r8','2026-10-27','시장 전략','2027년 시장 전망','{}'::text[],'iM증권','김준영','none','중립','none','참고용','2027 코스피 기본 7,500, 바닥 5,200. 상반기 SW·보안·피지컬AI, 하반기 메모리·원전·전력기기, 헬스케어는 방어.','보유 종목 동국제약과 간접 연관: 헬스케어를 방어주로 꼽았어요.','바닥 시나리오가 코스피 5,200이에요. 시장 전체 전망이라 개별 종목엔 바로 쓰기 어려워요.',null,null,null,38,'추정','기본 시나리오와 바닥 시나리오를 함께 내놓은 균형 잡힌 시각이에요.')
on conflict (id) do update set report_date=excluded.report_date,topic=excluded.topic,title=excluded.title,companies=excluded.companies,firm=excluded.firm,author=excluded.author,signal=excluded.signal,signal_label=excluded.signal_label,now_signal=excluded.now_signal,now_label=excluded.now_label,summary=excluded.summary,holding_link=excluded.holding_link,risk=excluded.risk,tp_stock=excluded.tp_stock,target_price=excluded.target_price,price_at_pub=excluded.price_at_pub,score=excluded.score,score_basis=excluded.score_basis,score_reason=excluded.score_reason, updated_at=now();

insert into report_holding_signals (stock,signal,status,note,sort_order) values
  ('HL만도','warn','주의','8/6 BNK는 매수(목표가 71,000원). 그런데 3분기 영업이익이 515억으로 리포트 예상 1,000억의 절반이에요.',0),
  ('동국제약','none','리포트 없음','직접 리포트는 없어요. iM 시장 전략에서 헬스케어를 방어주로 꼽아 간접적으로 긍정이에요.',1),
  ('지에프아이','none','리포트 없음','아직 분석한 리포트가 없어요.',2),
  ('상신이디피','none','리포트 없음','아직 분석한 리포트가 없어요.',3),
  ('신성에스티','none','리포트 없음','아직 분석한 리포트가 없어요.',4)
on conflict (stock) do update set signal=excluded.signal,status=excluded.status,note=excluded.note,sort_order=excluded.sort_order,updated_at=now();

