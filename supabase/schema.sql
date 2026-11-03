-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 Run 하세요.
-- 그다음 supabase/data.sql 을 같은 방법으로 Run 하면 카페와 구획이 들어갑니다.

-- 카페(식당) 목록. public/data/places.json 과 같은 내용
create table if not exists places (
  id           text primary key,          -- 'naver:네이버장소ID'
  name         text not null,
  category     text not null default '',
  address      text not null default '',
  road_address text not null default '',
  phone        text not null default '',
  url          text not null default '',
  lat          double precision not null,
  lng          double precision not null
);

-- 구획(동·도로·지명). public/data/areas.json 과 같은 내용
create table if not exists areas (
  name    text primary key,
  type    text not null default '',
  aliases text[] not null default '{}',
  kind    text not null check (kind in ('polygon', 'line')),
  shape   jsonb not null                  -- [[[위도, 경도], ...], ...]
);

-- 브라우저 1개 = 식당 1곳당 1표 (바꾸거나 취소 가능)
create table if not exists votes (
  place_id   text not null,
  voter_id   text not null,
  value      text not null check (value in ('yes', 'no')),
  updated_at timestamptz not null default now(),
  primary key (place_id, voter_id)
);

-- 모든 투표 시도 기록. 1시간 제한 판단과 사후 확인에 쓴다.
create table if not exists vote_logs (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  place_id   text not null,
  voter_id   text not null,
  ip_hash    text not null,
  value      text,            -- 'yes' | 'no' | null(취소)
  accepted   boolean not null -- false = 제한에 걸려 저장하지 않음
);
create index if not exists vote_logs_ip_recent on vote_logs (ip_hash, created_at) where accepted;

-- AI 검색 결과 캐시 (무료 한도 절약)
create table if not exists ai_cache (
  key        text primary key,
  value      jsonb not null,
  created_at timestamptz not null default now()
);

alter table places    enable row level security;
alter table areas     enable row level security;
alter table votes     enable row level security;
alter table vote_logs enable row level security;
alter table ai_cache  enable row level security;

-- 카페와 구획은 공개 정보라 누구나 읽을 수 있게 한다. 쓰기는 service role 키로만.
drop policy if exists "places read" on places;
create policy "places read" on places for select using (true);
drop policy if exists "areas read" on areas;
create policy "areas read" on areas for select using (true);

-- 투표 한 건 처리. 같은 IP의 최근 1시간 저장 건수가 p_limit 이상이면 저장하지 않는다.
create or replace function cast_vote(
  p_place_id text,
  p_voter_id text,
  p_ip_hash  text,
  p_value    text,
  p_limit    int default 30
)
returns table (status text, yes_count int, no_count int, mine text)
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
  result text := 'ok';
begin
  -- 같은 IP의 동시 요청이 한도를 함께 넘지 않도록 IP별로 줄을 세운다.
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into recent
  from vote_logs
  where ip_hash = p_ip_hash and accepted and created_at > now() - interval '1 hour';

  if recent >= p_limit then
    result := 'rate_limited';
    insert into vote_logs (place_id, voter_id, ip_hash, value, accepted)
    values (p_place_id, p_voter_id, p_ip_hash, p_value, false);
  else
    if p_value is null then
      delete from votes where place_id = p_place_id and voter_id = p_voter_id;
    else
      insert into votes (place_id, voter_id, value) values (p_place_id, p_voter_id, p_value)
      on conflict (place_id, voter_id) do update set value = excluded.value, updated_at = now();
    end if;
    insert into vote_logs (place_id, voter_id, ip_hash, value, accepted)
    values (p_place_id, p_voter_id, p_ip_hash, p_value, true);
  end if;

  return query
  select result,
         count(*) filter (where v.value = 'yes')::int,
         count(*) filter (where v.value = 'no')::int,
         max(v.value) filter (where v.voter_id = p_voter_id)
  from votes v
  where v.place_id = p_place_id;
end;
$$;

-- 식당별 가능/불가능 수와 내 표
create or replace function get_tallies(p_voter_id text)
returns table (place_id text, yes_count int, no_count int, mine text)
language sql
stable
security definer
set search_path = public
as $$
  select v.place_id,
         count(*) filter (where v.value = 'yes')::int,
         count(*) filter (where v.value = 'no')::int,
         max(v.value) filter (where v.voter_id = p_voter_id)
  from votes v
  group by v.place_id;
$$;

-- 투표 함수는 서버(service role 키)만 부를 수 있다. publishable/anon 키로는 permission denied.
revoke all on function cast_vote(text, text, text, text, int) from public, anon, authenticated;
revoke all on function get_tallies(text) from public, anon, authenticated;
grant execute on function cast_vote(text, text, text, text, int) to service_role;
grant execute on function get_tallies(text) to service_role;
