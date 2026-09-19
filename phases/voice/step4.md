# Step 4: precompute

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. 고정 문장은 발화 순간이 아니라 voice 등록 시점에
(문장 × voice)를 전부 미리 합성해 Storage에 둔다 (ADR-002). 단말은 이것을 내려받아 오프라인으로 재생한다.
Supabase·ElevenLabs 키는 아직 없다. 저장소는 인터페이스 뒤에 두고, 테스트는 메모리 구현으로 한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/src/lib/phrases.ts` (step 1)
- `/supabase/migrations/20260919000000_voice_schema.sql` (step 2 — `phrase_audio` 컬럼, `phrase-audio` bucket, 프리셋 경로 규칙)
- `/src/services/elevenlabs.ts` (step 3 — `ElevenLabs.synthesizePhrase`)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/services/voice-store.ts` — 서버의 Supabase 접근을 모으는 곳

```ts
export interface PhraseAudioRow {
  subjectId: string; phraseId: PhraseId; voiceProfileId: string; audioPath: string; charCount: number;
}
export interface VoiceStore {
  putAudio(path: string, data: ArrayBuffer): Promise<void>;          // 'phrase-audio' bucket, upsert, audio/mpeg
  listPhraseAudio(voiceProfileId: string): Promise<PhraseAudioRow[]>;
  upsertPhraseAudio(row: PhraseAudioRow): Promise<void>;             // on conflict (voice_profile_id, phrase_id)
}
export function createSupabaseVoiceStore(admin: SupabaseClient): VoiceStore;  // service_role 클라이언트
```
- `npm install @supabase/supabase-js`. 첫 줄 `import 'server-only';`
- 이후 step(등록·번들)이 이 인터페이스에 메서드를 추가한다. 지금은 위 3개만 만든다.
- `createSupabaseVoiceStore`는 얇게 유지한다. 실제 Supabase가 없어 이 step에서는 타입 체크만 한다.
- 테스트용 메모리 구현 `src/services/testing/memory-voice-store.ts`를 만든다 (`createMemoryVoiceStore()` — 저장한 오디오·행을 검사할 수 있게 노출).

### 2. `src/services/presets.ts`

```ts
export const PRESET_KEYS = ['default'] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
export function getPresetVoiceId(key: PresetKey): string;             // process.env.ELEVENLABS_PRESET_VOICE_ID. 없으면 throw
export function presetAudioPath(key: PresetKey, phraseId: PhraseId): string;  // 'presets/{key}/{phraseId}.mp3'
```
프리셋은 `voice_profiles`에 넣지 않는 전역 자산이다 (step 2 마이그레이션 주석 참고). 프리셋 목소리 선택은 키가 생긴 뒤 팀이 정한다.

### 3. `src/services/precompute.ts`

```ts
export function profileAudioPath(subjectId: string, voiceProfileId: string, phraseId: PhraseId): string;
  // '{subjectId}/{voiceProfileId}/{phraseId}.mp3'

export async function precomputeProfileAudio(
  deps: { store: VoiceStore; tts: Pick<ElevenLabs, 'synthesizePhrase'> },
  input: { subjectId: string; voiceProfileId: string; voiceId: string },
): Promise<{ synthesized: PhraseId[]; skipped: PhraseId[] }>;

export async function precomputePresetAudio(
  deps: { store: Pick<VoiceStore, 'putAudio'>; tts: Pick<ElevenLabs, 'synthesizePhrase'> },
  presetKey: PresetKey,
): Promise<void>;   // DB 행 없이 presetAudioPath에 업로드만
```

핵심 규칙:
- `PHRASES` 전체를 **순차로** 처리한다 (rate limit 회피. 5문장이라 충분하다).
- 문장마다 순서는 **합성 → 업로드 → 행 upsert**다. 행이 없는 오디오 객체를 가리키는 일이 없게 하기 위해서다.
- **멱등**: 이미 `phrase_audio` 행이 있는 문장은 건너뛴다(`skipped`). 재시도 때 크레딧을 다시 쓰지 않는다. 다시 돌려도 행이 중복되지 않는다.
- 중간 문장에서 실패하면 그대로 throw한다. 부분 완료 상태는 괜찮다 — 번들(step 6)은 모든 문장이 갖춰진 프로필만 내보낸다.

### 4. 테스트 `src/services/precompute.test.ts`

fake tts(호출 기록) + 메모리 store로:
- 5문장 전부 합성·업로드·행 저장, 경로가 `profileAudioPath` 규칙을 따른다, `charCount`가 맞다
- 두 번 실행하면 두 번째는 전부 `skipped`, tts 호출 0회, 행 5개 유지
- 3번째 문장에서 tts가 실패하면 throw. 앞 2문장의 행은 남고, 실패한 문장의 행은 없다
- `precomputePresetAudio('default')` → `presets/default/{id}.mp3` 5개 업로드, 행 저장 없음
- `getPresetVoiceId`는 환경변수가 없으면 throw

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 서버 코드가 `src/services/`에 있고 `server-only`를 import하는가?
   - CLAUDE.md CRITICAL 규칙: 합성은 등록 문장(`PhraseId`)으로만
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 문장을 병렬(`Promise.all`)로 합성하지 마라. 이유: ElevenLabs 동시 요청 한도에 걸린다.
- 프리셋 오디오를 `phrase_audio`에 저장하지 마라. 이유: `phrase_audio.voice_profile_id`는 NOT NULL이고, 프리셋은 `voice_profiles`에 넣지 않는다.
- 실제 Supabase·ElevenLabs에 연결하지 마라. 키가 없다는 이유로 `blocked` 처리하지도 마라. 이유: 이 step은 fake로 완결된다.
- API 라우트(`src/app/api/`)를 만들지 마라. 이유: Next.js 골격(A 담당)이 아직 없다.
- 기존 테스트를 깨뜨리지 마라.
