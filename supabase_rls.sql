-- ============================================================
-- siki-dream-rich RLS (Row Level Security) 켜기
-- Supabase 대시보드 > SQL Editor 에서 실행하세요
--
-- ⚠️ 실행 순서
--   1) Vercel 환경변수에 SUPABASE_SERVICE_ROLE_KEY 추가 후 재배포
--      (api/economic-calendar.js 가 푸시/DART/실적 알림 테이블에 접근할 때 사용)
--   2) 이 파일 실행
--      ※ supabase_migration.sql 에는 RLS를 끄는 줄이 들어 있어서, 그 파일을 다시 실행했다면
--        반드시 이 파일도 다시 실행해야 함
--   3) Supabase > Authentication > Sign In / Providers 에서
--      "Allow new users to sign up" 끄기 (모르는 사람이 가입해서 들어오는 것 차단)
--
-- 권한 구조
--   owner  : 앱 테이블 읽기 + 쓰기
--   guest  : 앱 테이블 읽기만 (앱의 게스트 모드와 동일)
--   그 외   : 아무것도 못 함 (로그인 안 한 사람, 공개 키만 가진 사람 포함)
--   서버    : service_role 키로 접근 (RLS 무시)
--
-- 여러 번 실행해도 안전합니다.
-- ============================================================

-- 1. 앱 사용자 역할 테이블
--    user_metadata.role 은 로그인한 사용자가 스스로 바꿀 수 있어서 권한 판단에 쓰면 안 됨.
--    대신 이 테이블(클라이언트가 수정 불가)에 역할을 고정해 둠.
create table if not exists app_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'guest')),
  created_at timestamptz default now()
);

-- 현재 계정의 역할을 그대로 옮겨옴 (앱의 AUTH_MAP 에 있는 3개 계정)
insert into app_users (user_id, role)
select id,
       case when raw_user_meta_data->>'role' = 'owner' then 'owner' else 'guest' end
from auth.users
where email in ('yoonsik0926@naver.com', '96uzz@naver.com', 'guest@naver.com')
on conflict (user_id) do update set role = excluded.role;

alter table app_users enable row level security;
drop policy if exists app_users_self_read on app_users;
create policy app_users_self_read on app_users
  for select to authenticated using (user_id = auth.uid());

-- 2. 역할 확인 함수 (security definer: app_users 를 RLS 없이 조회)
create or replace function public.app_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select role from app_users where user_id = auth.uid()
$$;

create or replace function public.is_app_member()
returns boolean
language sql stable
as $$ select public.app_role() in ('owner', 'guest') $$;

create or replace function public.is_app_owner()
returns boolean
language sql stable
as $$ select public.app_role() = 'owner' $$;

-- 3. public 스키마의 모든 테이블 RLS 켜기
--    아래 정책이 없는 테이블은 자동으로 잠김 (서버 service_role 만 접근 가능)
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- 4. 앱(브라우저)이 직접 읽고 쓰는 테이블: 멤버 읽기, 오너 쓰기
do $$
declare
  t text;
  app_tables text[] := array[
    'asset_shots', 'asset_snapshots', 'assets', 'compound_goals', 'condolences',
    'events', 'gifts', 'income', 'invest_terms', 'investment_records', 'journals',
    'mock_investments', 'realized_profits', 'realty', 'sector_map_stocks',
    'stock_notes', 'stocks', 'transactions', 'yt_summaries'
  ];
begin
  foreach t in array app_tables loop
    if to_regclass('public.' || t) is null then
      raise notice '테이블 없음, 건너뜀: %', t;
      continue;
    end if;
    execute format('drop policy if exists app_member_read on public.%I', t);
    execute format('drop policy if exists app_owner_write on public.%I', t);
    execute format(
      'create policy app_member_read on public.%I for select to authenticated using (public.is_app_member())', t);
    execute format(
      'create policy app_owner_write on public.%I for all to authenticated using (public.is_app_owner()) with check (public.is_app_owner())', t);
  end loop;
end $$;

-- 5. settings: 위와 같지만 VAPID 키(푸시 서명용 비밀키)는 브라우저에서 아예 안 보이게
drop policy if exists app_member_read on settings;
drop policy if exists app_owner_write on settings;
create policy app_member_read on settings
  for select to authenticated
  using (public.is_app_member() and key not like 'vapid\_%');
create policy app_owner_write on settings
  for all to authenticated
  using (public.is_app_owner() and key not like 'vapid\_%')
  with check (public.is_app_owner() and key not like 'vapid\_%');

-- 6. 서버 전용 테이블 (정책 없음 = service_role 만 접근)
--    push_subscriptions, dart_watchlist, earnings_watchlist, earnings_events,
--    portfolio_holdings, portfolio_snapshots(현재 settings 로 이전되어 미사용)

-- ── 확인용 ──
-- select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;
-- select * from app_users;

-- ── 되돌리기 (문제 생기면 이것만 실행하면 예전처럼 동작) ──
-- do $$ declare t record; begin
--   for t in select tablename from pg_tables where schemaname = 'public' loop
--     execute format('alter table public.%I disable row level security', t.tablename);
--   end loop;
-- end $$;
