# Step 2: voice-schema

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. Supabase 프로젝트는 아직 없다. 그래서 마이그레이션 SQL을 작성하고,
**PGlite(WASM Postgres)** 위에 Supabase 환경을 흉내 낸 스텁을 깔고 마이그레이션을 적용해 RLS를 테스트한다.
PGlite 0.5.x(Postgres 18)에서 `SET ROLE authenticated` 후 RLS가 적용되는 것은 확인했다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` — 데이터 모델 표, RLS 규칙
- `/docs/ADR.md` — ADR-008 (동의를 스키마로 강제)
- `/src/lib/phrases.ts` (step 1 산출물)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. 마이그레이션 `supabase/migrations/20260919000000_voice_schema.sql`

테이블 (모두 `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`):

| 테이블 | 컬럼 | 규칙 |
|---|---|---|
| `accounts` | `user_id uuid not null unique references auth.users(id) on delete cascade` | 최소 형태. plan·billing 컬럼은 결제 작업에서 추가한다 |
| `subjects` | `account_id uuid not null references accounts(id) on delete cascade`, `display_name text not null` | 최소 형태 |
| `consents` | `subject_id` (fk, cascade), `kind text not null`, `granted_by text not null`, `granted_at timestamptz not null default now()`, `revoked_at timestamptz`, `doc_version text not null`, `evidence jsonb` | `kind` CHECK: biometric / voice_self / voice_family / research_use / overseas_transfer / research_video / voice_retention. `granted_by` CHECK: self / legal_guardian / family. `unique (id, subject_id)` |
| `voice_profiles` | `subject_id` (fk, cascade), `source text not null`, `ref_audio_path text`, `provider_voice_id text not null`, `consent_id uuid not null` | **`consent_id` NOT NULL.** `(consent_id, subject_id)` → `consents(id, subject_id)` 복합 FK — 다른 대상자의 동의로 프로필을 만들 수 없다. `source` CHECK: **family / self만** (아래 참고). `unique (id, subject_id)`. `ref_audio_path`는 원본 파기 후 null |
| `phrase_audio` | `subject_id`, `phrase_id text not null`, `voice_profile_id uuid not null`, `audio_path text not null`, `char_count int not null` | `(voice_profile_id, subject_id)` → `voice_profiles(id, subject_id)` 복합 FK (on delete cascade). `unique (voice_profile_id, phrase_id)` |

**프리셋은 `voice_profiles`에 넣지 않는다.** `consent_id`가 NOT NULL인데 프리셋 목소리에는 대상자의 동의가 없기 때문이다.
프리셋 오디오는 전역 자산으로, Storage `phrase-audio/presets/{preset_key}/{phrase_id}.mp3`에 한 번만 합성해 둔다 (DB 행 없음).
이 결정과 이유를 SQL 파일 상단 주석에 적는다. `phrases` 테이블은 이번에 만들지 않는다 — 문장 원본은 `src/lib/phrases.ts`다.

RLS (5개 테이블 전부 `enable row level security`):
- `public.owns_subject(sid uuid) returns boolean` — `language sql stable security definer set search_path = ''`.
  `subjects` ⨝ `accounts`에서 `accounts.user_id = auth.uid()`인지 본다
- `accounts`: 본인 행(`user_id = auth.uid()`) select / insert / update
- `subjects`: 본인 계정 소속 행 select / insert / update / delete
- `consents`: `owns_subject(subject_id)`인 행 select / insert / update(철회용). delete 정책 없음 — 감사 추적
- `voice_profiles`, `phrase_audio`: `owns_subject(subject_id)`인 행 **select만**. 쓰기 정책을 만들지 않는다 — 쓰기는 서버(service_role)만 한다

Storage:
- private bucket 두 개를 `insert into storage.buckets (id, name, public, allowed_mime_types) ... on conflict (id) do nothing`로 만든다:
  `voice-refs`(참조 음성 원본), `phrase-audio`(사전 합성 오디오). `allowed_mime_types = array['audio/*']`
- `storage.objects`에 두 bucket 관련 정책을 **만들지 않는다.** 업로드·다운로드는 서버가 발급한 서명 URL로만 한다.
- `alter table storage.objects ...`를 하지 마라 — 호스티드 Supabase에서는 소유자가 아니라 실패하고, RLS는 Supabase가 이미 켜 둔다.

### 2. 테스트 하네스 `supabase/tests/pglite.ts`

`createTestDb(): Promise<PGlite>` — 아래 Supabase 스텁을 만든 뒤 `supabase/migrations/*.sql`을 이름순으로 적용한다.
- role `anon`, `authenticated`(둘 다 nologin), `service_role`(nologin **bypassrls**)
- `auth` schema, `auth.users(id uuid primary key)`, `auth.uid()` = `nullif(current_setting('request.jwt.claim.sub', true), '')::uuid`
- `storage` schema, `storage.buckets(id text pk, name text, public boolean, allowed_mime_types text[])`, `storage.objects(id uuid pk default gen_random_uuid(), bucket_id text, name text, owner uuid)` + objects에 RLS enable
- **Supabase와 같은 기본 권한**: `public`·`storage`·`auth` schema usage와, public 테이블에 대한 `alter default privileges ... grant all on tables to anon, authenticated, service_role` (마이그레이션 적용 전에). 이유: 실제 Supabase에서는 테이블 권한이 열려 있고 RLS만이 장벽이다. 권한 부족(permission denied)으로 통과하는 테스트는 RLS를 검증하지 못한다.

헬퍼: `asUser(db, userId, fn)` — `set role authenticated` + `request.jwt.claim.sub` 설정 후 fn 실행, 끝나면 `reset role`.

### 3. 테스트 `supabase/tests/voice-schema.test.ts`

두 사용자(계정 A·B)와 각자의 대상자를 superuser로 시드한 뒤:
- 마이그레이션이 에러 없이 적용된다
- 사용자 A는 B의 subjects / consents / voice_profiles / phrase_audio를 **0행** 조회한다 (A 자기 것은 보인다)
- `voice_profiles`에 `consent_id = null` insert → 실패
- 다른 대상자의 consent id로 `voice_profiles` insert → 실패 (복합 FK)
- `voice_profiles.source = 'preset'` insert → 실패
- authenticated는 **자기 대상자**에 대해서도 `voice_profiles`·`phrase_audio` insert가 실패한다 (RLS 위반)
- authenticated는 자기 대상자의 consents insert는 성공, 남의 대상자는 실패
- authenticated는 `voice-refs`·`phrase-audio` bucket의 `storage.objects`를 select 0행 / insert 실패

## Acceptance Criteria

```bash
npm install -D @electric-sql/pglite
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`supabase/migrations/`)
   - CLAUDE.md CRITICAL 규칙: 모든 테이블 RLS, `voice_profiles.consent_id` NOT NULL
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 마이그레이션 SQL 안에 `auth`·`storage` schema나 role을 만들지 마라. 이유: 실제 Supabase에 이미 있어 충돌한다. 스텁은 테스트 하네스에만 둔다.
- `utterances`·`landmark_samples`·`models` 등 이 phase와 무관한 테이블을 만들지 마라. 이유: 다른 담당 범위다.
- `voice_profiles`·`phrase_audio`에 authenticated 쓰기 정책을 만들지 마라. 이유: 클라이언트가 임의 오디오를 "그 사람 목소리"로 끼워 넣거나 동의 없이 프로필을 만드는 경로가 된다.
- 테스트에서 권한을 GRANT하지 않아 생기는 permission denied로 통과시키지 마라. 이유: RLS를 검증하지 못한다.
- 기존 테스트를 깨뜨리지 마라.
