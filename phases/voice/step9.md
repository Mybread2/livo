# Step 9: bundle-consent-guard

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. 지금 `getBundle`(`src/services/bundle.ts`)은 모든 문장이 합성된 최신 프로필을 고르는데,
**그 프로필의 동의가 철회됐는지 보지 않는다.** 가족 음성 동의를 철회해도 번들이 계속 그 목소리를 내보낸다.

철회 시 파기(step 10)는 외부 API·Storage 호출이라 실패할 수 있다. 번들은 파기 성공 여부와 상관없이
**동의가 살아 있는 프로필만** 내보내야 한다 — 이 step은 그 안전망이다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md` (ADR-008)
- `/src/services/bundle.ts`, `/src/services/bundle.test.ts`
- `/src/services/voice-store.ts` (`VoiceStore.listVoiceProfiles`, `listActiveConsents`)
- `/src/services/testing/memory-voice-store.ts`
- `/src/services/voice-profile.ts` (등록 시 동의 규칙 — 음성 동의 + `overseas_transfer`)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

1. `VoiceStore.listVoiceProfiles`의 반환에 `consentId`를 추가한다 (Supabase 구현 + 메모리 구현). 기존 테스트의 기대값도 맞춘다.
2. `getBundle`의 프로필 선택 규칙에 동의 조건을 더한다. 프로필이 번들 후보가 되려면:
   - 그 프로필의 `consentId`가 `listActiveConsents(subjectId)`에 있다 (철회되지 않음)
   - 대상자에게 철회되지 않은 `overseas_transfer` 동의가 있다 — 클로닝 목소리는 해외 API에서 만든 것이다
   - (기존) 모든 등록 문장의 `phrase_audio`가 있다
   조건을 만족하는 프로필이 없으면 기존처럼 프리셋으로 대체한다. `listActiveConsents`는 대상자당 한 번만 부른다.
3. 테스트 (`bundle.test.ts`에 추가):
   - 완성된 프로필의 음성 동의가 철회됨 → 프리셋
   - 최신 프로필 동의 철회 + 이전 프로필 동의 유효·완성 → 이전 프로필
   - `overseas_transfer` 철회 → 완성된 프로필이 있어도 프리셋
   - 동의가 모두 유효 → 기존 동작 그대로 (회귀)

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CLAUDE.md CRITICAL: 동의 레코드 없이 음성 처리 금지
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 번들에서 동의 철회를 이유로 에러를 던지지 마라. 이유: 번들은 항상 재생 가능한 목소리를 줘야 한다 — 응급 발화는 프리셋으로라도 나가야 한다.
- 번들 형식(`src/types/voice-bundle.ts`)에 동의 정보를 넣지 마라. 이유: 단말에는 재생할 오디오만 있으면 된다.
- 여기서 파기(ElevenLabs·Storage 삭제)를 하지 마라. 이유: 조회 경로에 부수효과를 넣지 않는다. 파기는 step 10이다.
- 기존 테스트를 깨뜨리지 마라.
