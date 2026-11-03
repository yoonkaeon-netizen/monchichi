-- Supabase 대시보드 > SQL Editor에 통째로 붙여넣고 Run 하세요.
-- 모든 테이블은 서버(Vercel 함수)만 service role 키로 접근합니다. 브라우저에서 직접 읽고 쓰지 않습니다.

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

alter table votes     enable row level security;
alter table vote_logs enable row level security;
alter table ai_cache  enable row level security;

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

revoke all on function cast_vote(text, text, text, text, int) from public, anon, authenticated;
revoke all on function get_tallies(text) from public, anon, authenticated;
grant execute on function cast_vote(text, text, text, text, int) to service_role;
grant execute on function get_tallies(text) to service_role;
