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

-- 기존 [공시 알림] 관심 기업 옮겨오기
insert into bot_watch_companies (market, ticker, name, corp_code, yahoo_symbol)
select 'KR', coalesce(stock_code, corp_code), corp_name, corp_code, stock_code || '.KS' from dart_watchlist
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
