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
  buy_date     date not null,
  sell_price   numeric,
  sell_date    date,
  note         text not null default '',
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

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
