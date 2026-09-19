# Step 16: voice-palette

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. 팀은 ElevenLabs **무료 플랜**만 쓴다. 무료 플랜 API로는 클로닝(Instant Voice Cloning)도
Voice Design(목소리 생성)도 안 되고, **이미 있는 목소리로 문장 합성만** 된다 (실호출로 확인: 400 `paid_plan_required`, 403 `feature_not_available`).
그래서 "그 사람과 닮은 목소리"는 **목소리 팔레트**로 푼다: 팀이 ElevenLabs 웹에서 성별·연령대별 목소리 6개를 직접 만들고,
각 목소리로 15문장을 한 번씩 사전 합성해 Storage에 둔 뒤, 보호자가 가장 닮은 것을 고른다 (기획서 §6 "1일차: 성별·연령대 프리셋").
웹에서 만든 목소리는 무료 슬롯 한도 때문에 합성 후 지울 수 있다 — 그래서 **이미 합성된 프리셋은 다시 합성하지 않아야** 한다.

이 step은 팔레트 정의와 프리셋 합성(스크립트 포함)을 바꾼다. 대상자별 선택(step 17)과 라우트(step 18)는 다음 step이다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/src/services/presets.ts`, `/src/services/precompute.ts`, `/src/services/precompute.test.ts`
- `/src/services/voice-store.ts`, `/src/services/testing/memory-voice-store.ts`
- `/src/services/bundle.ts`, `/src/services/bundle.test.ts` (프리셋 대체 경로)
- `/scripts/precompute-presets.ts`, `/scripts/preset-env.ts`, `/scripts/preset-env.test.ts`, `/.env.example`
- `/src/lib/phrases.ts`

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/lib/voice-presets.ts` — 공용 팔레트 정의 (클라이언트도 import한다 — voice_id를 넣지 않는다)

```ts
export const VOICE_PRESETS = [
  { key: "male-30s",   gender: "male",   ageBand: "30s", label: "남성 · 30대" },
  { key: "male-50s",   gender: "male",   ageBand: "50s", label: "남성 · 50대" },
  { key: "male-70s",   gender: "male",   ageBand: "70s", label: "남성 · 70대" },
  { key: "female-30s", gender: "female", ageBand: "30s", label: "여성 · 30대" },
  { key: "female-50s", gender: "female", ageBand: "50s", label: "여성 · 50대" },
  { key: "female-70s", gender: "female", ageBand: "70s", label: "여성 · 70대" },
] as const;
export type VoicePresetKey = (typeof VOICE_PRESETS)[number]["key"];
export const DEFAULT_VOICE_PRESET: VoicePresetKey = "male-50s";
export function isVoicePresetKey(value: unknown): value is VoicePresetKey;
```

### 2. `src/services/presets.ts` — 서버 전용 목소리 표

- `PRESET_KEYS`·`PresetKey`('default')와 환경변수 기반 `getPresetVoiceId`를 없애고, 팔레트 키를 쓴다.
- `PRESET_VOICE_IDS: Record<VoicePresetKey, string | null>` — `male-50s`는 `"ld4WnBGjZkAYMoRQz6p9"`(현재 프리셋), 나머지는 `null`(팀이 웹에서 만들면 채운다). voice_id는 비밀이 아니지만 단말·번들로 내보내지 않는다.
- `getPresetVoiceId(key: VoicePresetKey): string | null`
- `presetAudioPath(key: VoicePresetKey, phraseId: PhraseId): string` → `'presets/{key}/{phraseId}.mp3'`
- `presetAudioPrefix(key)` → `'presets/{key}/'`

### 3. `VoiceStore.listAudio(prefix: string): Promise<string[]>` 추가 (Supabase + 메모리)

`phrase-audio` bucket에서 prefix 아래 파일 경로 전체(페이지 넘김 포함)를 돌려준다.

### 4. `precomputePresetAudio` 변경 (`src/services/precompute.ts`)

```ts
export async function precomputePresetAudio(
  deps: { store: Pick<VoiceStore, "putAudio" | "listAudio">; tts: Tts },
  presetKey: VoicePresetKey,
): Promise<{ synthesized: PhraseId[]; skipped: PhraseId[] }>;
```
- 이미 있는 문장 파일은 건너뛴다 (`skipped`). 없는 것만 합성한다 — 웹에서 목소리를 지운 뒤 다시 실행해도 호출이 0회여야 한다.
- 합성할 문장이 남았는데 voice_id가 `null`이면 throw한다.
- 순차 처리.

`isPresetComplete(store: Pick<VoiceStore, "listAudio">, key): Promise<boolean>`도 export한다 (step 17의 번들·선택이 쓴다).

### 5. 번들 기본값 (`src/services/bundle.ts`)

프리셋 대체를 `DEFAULT_VOICE_PRESET`으로 바꾼다: `version: 'preset:male-50s'`, 경로 `presets/male-50s/...`. (대상자별 선택은 step 17)

### 6. 스크립트 `scripts/precompute-presets.ts`

- `ELEVENLABS_PRESET_VOICE_ID`를 필수 환경변수에서 뺀다 (`preset-env.ts`의 목록과 테스트, `.env.example`에서도 제거).
- `VOICE_PRESETS` 전체를 돈다: voice_id가 `null`이면 "대기(목소리 미생성)"로 출력하고 건너뛴다. 아니면 `precomputePresetAudio` 후 `합성 n · 건너뜀 m` 출력.
- 여전히 인자를 받지 않는다.

### 7. 테스트

- `voice-presets`: 키 중복 없음, `DEFAULT_VOICE_PRESET`이 목록에 있음, `isVoicePresetKey`
- `precomputePresetAudio`: 전부 없으면 15개 합성 · 일부 있으면 나머지만 · 전부 있으면 합성 0회(voice_id가 `null`이어도 throw하지 않음) · 남은 게 있는데 voice_id `null`이면 throw
- `isPresetComplete`, 메모리 `listAudio`
- 번들 기본값이 `preset:male-50s`
- 기존 테스트의 `'default'`·`preset:default` 기대값을 새 키로 맞춘다

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
ELEVENLABS_API_KEY= NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= npm run precompute:presets 2>err.txt; test $? -ne 0 && grep -q ELEVENLABS_API_KEY err.txt && ! grep -q ELEVENLABS_PRESET_VOICE_ID err.txt; rc=$?; rm -f err.txt; exit $rc
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CLAUDE.md CRITICAL: 임의 텍스트 합성 경로 없음(합성은 `PhraseId`만), 키는 서버에만, 번들·클라이언트 파일에 voice_id 없음
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `npm run precompute:presets`를 실제 키로 실행하지 마라 (위 AC처럼 빈 값으로만). 이유: 크레딧을 쓰고, 목소리 준비는 사용자와 함께 한다.
- `src/lib/voice-presets.ts`에 voice_id를 넣지 마라. 이유: 클라이언트 번들에 들어가는 파일이다.
- Voice Design·클로닝 API 호출을 추가하지 마라. 이유: 무료 플랜에서 막혀 있다.
- 기존 테스트를 깨뜨리지 마라.
