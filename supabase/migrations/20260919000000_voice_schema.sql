-- 목소리(C 담당) 스키마: accounts · subjects · consents · voice_profiles · phrase_audio
--
-- 프리셋 목소리는 voice_profiles에 넣지 않는다.
--   voice_profiles.consent_id는 NOT NULL(ADR-008)인데, 프리셋 목소리에는 대상자의 음성 동의가 없다.
--   프리셋 오디오는 전역 자산으로 Storage phrase-audio/presets/{preset_key}/{phrase_id}.mp3에
--   한 번만 합성해 둔다 (DB 행 없음).
-- phrases 테이블은 만들지 않는다. 문장 원본은 src/lib/phrases.ts이고 phrase_audio.phrase_id는 그 id다.
-- voice_profiles · phrase_audio는 authenticated에게 select만 연다. 쓰기는 서버(service_role)만 한다.
-- storage.objects에 voice-refs · phrase-audio 정책을 두지 않는다. 업로드·다운로드는 서버가 발급한 서명 URL로만 한다.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text not null check (kind in (
    'biometric', 'voice_self', 'voice_family', 'research_use',
    'overseas_transfer', 'research_video', 'voice_retention'
  )),
  granted_by text not null check (granted_by in ('self', 'legal_guardian', 'family')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  doc_version text not null,
  evidence jsonb,
  created_at timestamptz not null default now(),
  unique (id, subject_id)
);

create table public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  source text not null check (source in ('family', 'self')),
  ref_audio_path text, -- 참조 음성 원본 파기 후 null
  provider_voice_id text not null,
  consent_id uuid not null,
  created_at timestamptz not null default now(),
  unique (id, subject_id),
  -- 다른 대상자의 동의로 프로필을 만들 수 없다
  foreign key (consent_id, subject_id) references public.consents(id, subject_id)
);

create table public.phrase_audio (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null,
  phrase_id text not null,
  voice_profile_id uuid not null,
  audio_path text not null,
  char_count int not null,
  created_at timestamptz not null default now(),
  unique (voice_profile_id, phrase_id),
  foreign key (voice_profile_id, subject_id) references public.voice_profiles(id, subject_id) on delete cascade
);

-- RLS

create function public.owns_subject(sid uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.subjects s
    join public.accounts a on a.id = s.account_id
    where s.id = sid and a.user_id = auth.uid()
  );
$$;

alter table public.accounts enable row level security;
alter table public.subjects enable row level security;
alter table public.consents enable row level security;
alter table public.voice_profiles enable row level security;
alter table public.phrase_audio enable row level security;

create policy accounts_select on public.accounts for select to authenticated
  using (user_id = (select auth.uid()));
create policy accounts_insert on public.accounts for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy accounts_update on public.accounts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy subjects_select on public.subjects for select to authenticated
  using (account_id in (select id from public.accounts where user_id = (select auth.uid())));
create policy subjects_insert on public.subjects for insert to authenticated
  with check (account_id in (select id from public.accounts where user_id = (select auth.uid())));
create policy subjects_update on public.subjects for update to authenticated
  using (account_id in (select id from public.accounts where user_id = (select auth.uid())))
  with check (account_id in (select id from public.accounts where user_id = (select auth.uid())));
create policy subjects_delete on public.subjects for delete to authenticated
  using (account_id in (select id from public.accounts where user_id = (select auth.uid())));

-- delete 정책 없음 — 동의 기록은 철회(revoked_at)로만 남긴다 (감사 추적)
create policy consents_select on public.consents for select to authenticated
  using (public.owns_subject(subject_id));
create policy consents_insert on public.consents for insert to authenticated
  with check (public.owns_subject(subject_id));
create policy consents_update on public.consents for update to authenticated
  using (public.owns_subject(subject_id))
  with check (public.owns_subject(subject_id));

-- 쓰기 정책 없음 — 클라이언트가 임의 오디오를 "그 사람 목소리"로 끼워 넣는 경로를 막는다
create policy voice_profiles_select on public.voice_profiles for select to authenticated
  using (public.owns_subject(subject_id));
create policy phrase_audio_select on public.phrase_audio for select to authenticated
  using (public.owns_subject(subject_id));

-- Storage — private bucket. storage.objects 정책은 만들지 않는다 (서명 URL 전용)

insert into storage.buckets (id, name, public, allowed_mime_types)
values
  ('voice-refs', 'voice-refs', false, array['audio/*']),
  ('phrase-audio', 'phrase-audio', false, array['audio/*'])
on conflict (id) do nothing;
