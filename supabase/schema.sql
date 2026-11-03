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

-- AI 검색 결과 캐시 (무료 한도 절약)
create table if not exists ai_cache (
  key        text primary key,
  value      jsonb not null,
  created_at timestamptz not null default now()
);

alter table places   enable row level security;
alter table areas    enable row level security;
alter table ai_cache enable row level security;

-- 카페와 구획은 공개 정보라 누구나 읽을 수 있게 한다. 쓰기는 service role 키로만.
drop policy if exists "places read" on places;
create policy "places read" on places for select using (true);
drop policy if exists "areas read" on areas;
create policy "areas read" on areas for select using (true);
