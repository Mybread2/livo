# Step 11: precompute-resume

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. `registerVoiceProfile`(`src/services/voice-profile.ts`)은
클론 → 프로필 저장 → 사전 합성 순서로 진행한다. 사전 합성이 도중에 실패하면 프로필은 생겼는데 오디오가 일부만 있는 상태가 되고,
호출자는 `profile_id`도 모른 채 에러만 받는다. 번들은 부분 완료 프로필을 건너뛰므로 그 목소리는 영영 쓰이지 않는다.
이 step은 실패 시 `profile_id`를 알려주고, 남은 문장만 이어서 합성하는 재시도 함수를 만든다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/src/services/voice-profile.ts`, `/src/services/voice-profile.test.ts`
- `/src/services/precompute.ts` (`precomputeProfileAudio` — 이미 있는 문장은 건너뛰는 멱등 함수)
- `/src/services/voice-store.ts` (`getVoiceProfile`, `listActiveConsents` — step 10에서 추가됨), `/src/services/testing/memory-voice-store.ts`

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/services/voice-profile.ts`

```ts
export class PrecomputeIncompleteError extends Error {
  profileId: string;   // 재시도에 쓴다
  cause: unknown;
}

export async function resumePrecompute(
  deps: { store: VoiceStore; tts: Pick<ElevenLabs, 'synthesizePhrase'> },
  input: { userId: string; subjectId: string; voiceProfileId: string },
): Promise<{ synthesized: PhraseId[]; skipped: PhraseId[] }>;
```

- `registerVoiceProfile`에서 `precomputeProfileAudio`가 실패하면 `PrecomputeIncompleteError(profileId, 원래 오류)`를 던진다. 그 앞 단계(클론·저장·원본 파기)의 동작은 바꾸지 않는다.
- `resumePrecompute`:
  1. `ownsSubject`가 false → `ForbiddenError`
  2. 프로필이 없거나 `subjectId`가 다르면 → `ForbiddenError`
  3. **동의 재확인**: 프로필의 `consentId`와 `overseas_transfer`가 둘 다 철회되지 않았어야 한다. 아니면 `ConsentRequiredError`, 합성 호출 0회. 합성은 클로닝 목소리로 해외 API를 부르는 일이다
  4. `precomputeProfileAudio({ subjectId, voiceProfileId, voiceId: providerVoiceId })` 결과를 그대로 돌려준다

### 2. 테스트 (`voice-profile.test.ts`에 추가)

- 등록 중 3번째 문장 합성 실패 → `PrecomputeIncompleteError`, `profileId`가 저장된 프로필 id, `phrase_audio` 2행
- 이어서 `resumePrecompute` → `skipped` 2개·`synthesized` 3개, `phrase_audio` 5행
- 다 된 프로필에 다시 부르면 전부 `skipped`, 합성 0회
- 음성 동의 또는 `overseas_transfer`가 철회됨 → `ConsentRequiredError`, 합성 0회
- 남의 대상자, 다른 대상자의 프로필 id → `ForbiddenError`

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CLAUDE.md CRITICAL: 동의 없는 음성 처리 금지, 임의 텍스트 합성 경로 금지
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 사전 합성 실패 시 프로필을 자동 삭제하거나 ElevenLabs voice를 지우지 마라. 이유: 이미 합성된 문장과 클론을 버리게 되고, 재시도가 더 싸다.
- `resumePrecompute`에 문장 목록이나 텍스트를 입력으로 받지 마라. 이유: 합성 대상은 항상 `PHRASES` 전체다 — 임의 텍스트 경로가 생긴다.
- API 라우트를 만들지 마라. 이유: Next.js 골격(A 담당)이 아직 없다.
- 기존 테스트를 깨뜨리지 마라.
