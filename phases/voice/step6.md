# Step 6: bundle

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. 단말(병상 태블릿)은 오프라인 발화를 위해 사전 합성 오디오를 미리 내려받는다.
이 step은 `GET /api/bundle/:subject_id`의 본체 — "지금 단말이 가져가야 할 오디오 목록 + 서명 URL"을 만든다.
라우트는 Next.js 골격(A 담당)이 올라온 뒤 얇은 래퍼로 만든다. 인식기 번들(B 담당)은 이 phase 범위 밖이다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (상태 관리 — 프로필 교체 중 이전 목소리 유지), `/docs/ADR.md` (ADR-002)
- `/src/services/voice-store.ts`, `/src/services/testing/memory-voice-store.ts` (step 4·5)
- `/src/services/presets.ts`, `/src/services/precompute.ts` (step 4)
- `/src/services/voice-profile.ts` (step 5 — `ForbiddenError`, `VoiceSource`)
- `/src/lib/phrases.ts` (step 1)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/types/voice-bundle.ts` — 서버 ↔ 단말 번들 형식 (둘 다 C 모듈)

```ts
export interface VoiceBundle {
  version: string;                     // voice_profile_id 또는 'preset:default'. 단말이 목소리 교체를 감지하는 키
  source: 'preset' | 'self' | 'family';
  items: { phraseId: PhraseId; url: string }[];   // 서명 URL
  expiresAt: string;                   // ISO 8601. 서명 URL 만료 시각
}
```
`src/types/voice.ts`(A ↔ C 계약)는 건드리지 않는다.

### 2. `VoiceStore`에 메서드 추가 (Supabase 구현 + 메모리 구현)

```ts
listVoiceProfiles(subjectId: string): Promise<{ id: string; source: VoiceSource; createdAt: string }[]>;  // created_at desc
```
`listPhraseAudio`, `signedAudioUrl`은 이미 있다.

### 3. `src/services/bundle.ts`

```ts
export async function getBundle(
  deps: { store: VoiceStore; now?: () => Date },
  input: { userId: string; subjectId: string; expiresInSec?: number },   // 기본 3600
): Promise<VoiceBundle>;
```

규칙:
- `ownsSubject`가 false → `ForbiddenError`.
- 대상자의 프로필을 최신순으로 보고, **`PHRASES`의 모든 문장에 대해 `phrase_audio`가 있는 첫 프로필**을 고른다. 최신 프로필이 아직 사전 합성 중(부분 완료)이면 건너뛰고 이전의 완성된 프로필을 준다 — 목소리 교체 중에도 이전 목소리로 발화가 끊기지 않게 하기 위해서다.
- 완성된 프로필이 하나도 없으면 프리셋으로 대체한다: `version: 'preset:default'`, `source: 'preset'`, 경로는 `presetAudioPath('default', id)`. 응급 발화는 목소리 등록 여부와 상관없이 항상 나가야 한다.
- `items`는 `PHRASES` 순서를 따르고, 각 `url`은 `signedAudioUrl(path, expiresInSec)`.

### 4. 테스트 `src/services/bundle.test.ts`

- 프로필 없음 → preset 번들, 5개 항목, 경로가 `presets/default/...`
- 완성된 프로필 1개 → 그 프로필 id가 `version`, `source`가 프로필 source
- 최신 프로필이 3/5만 합성됨 + 이전 완성 프로필 → 이전 프로필이 선택된다
- 최신 프로필도 완성되면 → 최신 프로필
- 남의 대상자 → `ForbiddenError`, 서명 URL 발급 0회
- `expiresAt` = now + expiresInSec

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 상태 관리: 교체 중 이전 오디오 유지
   - CLAUDE.md CRITICAL 규칙 위반 없음
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 부분 완료된 프로필을 번들로 내보내지 마라. 이유: 단말이 일부 문장만 새 목소리로, 나머지는 소리 없이 재생하게 된다.
- 번들에 ElevenLabs `voice_id`나 참조 음성 경로를 넣지 마라. 이유: 단말에는 재생할 오디오만 있으면 되고, voice_id는 서버 밖으로 나갈 이유가 없다.
- 인식기(템플릿·ONNX) 번들을 만들지 마라. 이유: B 담당이다.
- 기존 테스트를 깨뜨리지 마라.
