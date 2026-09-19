# Step 17: subject-voice-preset

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. step 16에서 목소리 팔레트(성별·연령대별 프리셋 6개)를 만들었다.
이 step은 **대상자별로 고른 프리셋**을 저장하고, 번들이 그것을 쓰게 한다. 보호자가 미리듣기로 가장 닮은 목소리를 고르는 기능의 서버 쪽이다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/supabase/migrations/` (두 파일 — `subjects`는 A의 0001_init, 정책은 C의 voice_schema), `/supabase/tests/voice-schema.test.ts`, `/supabase/tests/pglite.ts`
- `/src/lib/voice-presets.ts`, `/src/services/presets.ts`, `/src/services/precompute.ts` (`isPresetComplete`) — step 16
- `/src/services/bundle.ts`, `/src/services/bundle.test.ts`
- `/src/services/voice-store.ts`, `/src/services/testing/memory-voice-store.ts`
- `/src/services/voice-profile.ts` (`ForbiddenError`), `/src/services/api.ts` (`BadRequestError`)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. 마이그레이션 `supabase/migrations/20260919020000_subject_voice_preset.sql`

- `alter table public.subjects add column voice_preset text;` — null이면 기본 프리셋. 주석에 팔레트 키는 코드(`src/lib/voice-presets.ts`)가 정하므로 DB CHECK를 두지 않는다고 적는다 (팔레트가 바뀔 때마다 마이그레이션이 필요해진다).
- 정책은 건드리지 않는다. (클라이언트가 자기 대상자 행을 update할 수 있어 이 컬럼을 직접 바꿀 수도 있다 — 번들이 읽을 때 검증하므로 괜찮다)
- 테스트(`voice-schema.test.ts`에 추가): 컬럼이 있고 기본값이 null, 기존 정책 테스트 통과

### 2. `VoiceStore`에 메서드 추가 (Supabase + 메모리)

```ts
getSubjectVoicePreset(subjectId: string): Promise<string | null>;
setSubjectVoicePreset(subjectId: string, key: VoicePresetKey): Promise<void>;
```

### 3. `src/services/voice-preset.ts`

```ts
import 'server-only';
export const PREVIEW_PHRASE_ID: PhraseId = "reposition";   // 미리듣기 문장 "자세 바꿔주세요"

export async function listVoicePresets(
  deps: { store: VoiceStore },
  input: { expiresInSec?: number },   // 기본 600
): Promise<{ key: VoicePresetKey; label: string; gender: string; ageBand: string; previewUrl: string }[]>;

export async function selectVoicePreset(
  deps: { store: VoiceStore },
  input: { userId: string; subjectId: string; presetKey: unknown },
): Promise<{ presetKey: VoicePresetKey }>;
```
- `listVoicePresets`: **15문장이 다 합성된 프리셋만** 돌려준다 (`isPresetComplete`). 미리듣기는 `PREVIEW_PHRASE_ID` 오디오의 서명 URL. 순서는 `VOICE_PRESETS` 순서.
- `selectVoicePreset`: `ownsSubject` 아니면 `ForbiddenError` → `isVoicePresetKey` 아니면 `BadRequestError` → 합성이 덜 된 프리셋이면 `BadRequestError` → 저장.

### 4. 번들 (`src/services/bundle.ts`)

동의가 살아 있는 완성된 클로닝 프로필이 없을 때의 대체 순서:
1. 대상자의 `voice_preset`이 유효한 키이고 `isPresetComplete`이면 그 프리셋 → `version: 'preset:{key}'`
2. 아니면 `DEFAULT_VOICE_PRESET`

(클로닝 프로필이 있으면 기존처럼 그것이 우선한다.) 대상자가 DB에서 직접 이상한 값을 넣어도 번들은 기본 프리셋으로 동작해야 한다.

### 5. 테스트

- `voice-preset.test.ts`: 완성된 프리셋만 목록에 나옴 + 미리듣기 URL · 선택 성공 · 남의 대상자 403(ForbiddenError) · 잘못된 키 · 미완성 프리셋 → BadRequestError
- `bundle.test.ts`: 선택한 프리셋 사용 · 선택값이 무효/미완성이면 기본 · 클로닝 프로필이 있으면 프로필 우선

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CLAUDE.md CRITICAL: 모든 테이블 RLS 유지, 번들에 voice_id 없음, 응급 발화는 항상 나감(번들이 에러 없이 기본 프리셋으로 대체)
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 기존 마이그레이션 파일을 수정하지 마라. 이유: 이미 Supabase에 적용됐다. 새 파일로만 바꾼다.
- 실제 Supabase에 마이그레이션을 적용하지 마라. 이유: 공용 DB 변경은 사용자 확인 후 따로 한다.
- 번들에서 선택값 문제로 에러를 던지지 마라. 이유: 응급 발화는 기본 프리셋으로라도 나가야 한다.
- 라우트는 만들지 마라. 이유: step 18이다.
- 기존 테스트를 깨뜨리지 마라.
