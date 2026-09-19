# Step 8: revoke-delete-rls

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. step 0~7에서 사전 합성·등록·번들·재생을 만들었다.
step 8~12는 **파기 경로**를 만든다: 동의 철회 시 목소리 파기, 대상자 삭제 시 Storage·ElevenLabs 정리, 사전 합성 재시도, 프리셋 합성 스크립트.

지금 RLS는 클라이언트(authenticated)가 `consents`를 직접 update(철회)하고 `subjects`를 직접 delete할 수 있게 열어 두었다.
그 경로로 철회·삭제하면 서버가 모르므로 ElevenLabs voice·Storage 파일 파기가 일어나지 않는다 (DB cascade는 Storage와 외부 API를 지우지 못한다).
그래서 **철회와 대상자 삭제를 서버(service_role) 전용**으로 바꾼다. 서버 함수는 step 10에서 만든다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (데이터 모델 · RLS · 보관 규칙), `/docs/ADR.md` (ADR-008)
- `/supabase/migrations/20260919000000_voice_schema.sql` — 현재 정책. **수정하지 말고** 새 마이그레이션을 추가한다
- `/supabase/tests/pglite.ts`, `/supabase/tests/voice-schema.test.ts`

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

1. 새 마이그레이션 `supabase/migrations/20260919010000_server_only_revoke_delete.sql`
   - `drop policy consents_update on public.consents;`
   - `drop policy subjects_delete on public.subjects;`
   - 파일 상단 주석에 이유를 적는다: 철회·삭제는 목소리 파기(ElevenLabs voice, Storage 파일)를 동반해야 하므로 서버 함수만 한다.
2. 테스트 (`supabase/tests/voice-schema.test.ts`에 추가):
   - authenticated가 **자기 대상자**의 consents를 update해도 `revoked_at`이 바뀌지 않는다 (RLS update 정책이 없으면 에러 없이 0행 갱신된다 — 값이 그대로인지로 확인)
   - authenticated가 **자기 대상자**를 delete해도 행이 남는다
   - 자기 대상자의 consents insert·select, subjects insert·select·update는 여전히 된다 (회귀 확인)
   - superuser(service_role 대신)는 두 작업이 된다

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CLAUDE.md CRITICAL: 모든 테이블 RLS 유지, `voice_profiles.consent_id` NOT NULL 유지
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 기존 마이그레이션 `20260919000000_voice_schema.sql`을 수정하지 마라. 이유: 마이그레이션은 추가만 한다 — 이미 적용된 환경과 어긋난다.
- consents에 delete 정책을 만들지 마라. 이유: 동의 기록은 철회로만 남긴다 (감사 추적).
- RLS를 끄거나(`disable row level security`) 다른 정책을 건드리지 마라. 이유: 이 step은 두 정책 제거만 다룬다.
- 기존 테스트를 깨뜨리지 마라.
