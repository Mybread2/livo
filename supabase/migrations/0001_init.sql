-- 입모아(IP-MOA) 초기 스키마 골격.
-- 근거: docs/ARCHITECTURE.md "데이터 모델". 핵심 테이블만 우선 만든다.
-- CRITICAL: 모든 테이블과 storage.objects에 RLS. utterances에 좌표·오디오 저장 금지.
--           voice_profiles.consent_id 는 NOT NULL.
-- 이 파일은 골격이다. 컬럼·정책은 다음 단계에서 채운다.

-- 계정(보호자) : 대상자 = 1 : N
create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null default 'free',
  created_at timestamptz not null default now()
);

create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  display_name text not null,
  birth_year int,
  sex text,
  condition text,
  trigger_mode text not null default 'auto',
  created_at timestamptz not null default now()
);

-- 동의 — 종류·주체·문서버전·철회시각
create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  kind text not null,          -- biometric / voice_self / voice_family / research_use / overseas_transfer / research_video / voice_retention
  granted_by text not null,    -- self / legal_guardian / family
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  doc_version text not null,
  evidence jsonb
);

-- 음성 프로필 — consent_id NOT NULL (동의 없는 처리 불가)
create table if not exists voice_profiles (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  source text not null,        -- preset / family / self
  ref_audio_path text,
  provider_voice_id text,
  consent_id uuid not null references consents(id),
  created_at timestamptz not null default now()
);

-- 발화 로그 — 좌표·오디오 저장 금지
create table if not exists utterances (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  track text not null default 'fixed',   -- fixed / free
  phrase_id text,
  text text,
  score numeric,
  gate_result text,            -- speak / show (discard는 저장하지 않음)
  latency_ms int,
  created_at timestamptz not null default now()
);

-- RLS: 전 테이블 활성화. 접근은 subjects.account_id -> accounts.user_id = auth.uid()
alter table accounts enable row level security;
alter table subjects enable row level security;
alter table consents enable row level security;
alter table voice_profiles enable row level security;
alter table utterances enable row level security;

-- 정책 골격: 본인 계정의 데이터만. (세부 정책은 다음 단계에서 보강)
create policy "own account" on accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own subjects" on subjects
  for all using (
    account_id in (select id from accounts where user_id = auth.uid())
  ) with check (
    account_id in (select id from accounts where user_id = auth.uid())
  );

create policy "own consents" on consents
  for all using (
    subject_id in (
      select s.id from subjects s
      join accounts a on a.id = s.account_id
      where a.user_id = auth.uid()
    )
  );

create policy "own voice_profiles" on voice_profiles
  for all using (
    subject_id in (
      select s.id from subjects s
      join accounts a on a.id = s.account_id
      where a.user_id = auth.uid()
    )
  );

create policy "own utterances" on utterances
  for all using (
    subject_id in (
      select s.id from subjects s
      join accounts a on a.id = s.account_id
      where a.user_id = auth.uid()
    )
  );
