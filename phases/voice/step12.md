# Step 12: preset-script

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. 프리셋 목소리 오디오는 대상자와 무관한 전역 자산으로,
(문장 × 프리셋)을 **한 번** 합성해 Storage `phrase-audio/presets/{preset_key}/{phrase_id}.mp3`에 둔다.
합성 함수 `precomputePresetAudio`(`src/services/precompute.ts`)는 있지만 실행할 진입점이 없다.
키(ElevenLabs·Supabase)는 아직 없다. 이 step은 키가 생기면 한 줄로 돌릴 수 있는 스크립트를 만들고,
**키가 없을 때는 네트워크 호출 전에 명확히 실패하는지**까지만 검증한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/src/services/precompute.ts` (`precomputePresetAudio`), `/src/services/presets.ts` (`PRESET_KEYS`, `getPresetVoiceId`)
- `/src/services/voice-store.ts` (`createSupabaseVoiceStore`), `/src/services/elevenlabs.ts` (`createElevenLabs`)
- `/package.json`, `/eslint.config.mjs`, `/tsconfig.json`, `/.env.example`

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

1. `scripts/precompute-presets.ts`
   - 필요한 환경변수: `ELEVENLABS_API_KEY`, `ELEVENLABS_PRESET_VOICE_ID`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. **빈 문자열도 없는 것으로 본다.**
   - 하나라도 없으면 **어떤 네트워크 호출도 하기 전에**, 빠진 변수 **이름**을 stderr에 출력하고 exit code 1로 끝낸다.
   - 다 있으면 service role Supabase 클라이언트(`persistSession: false`)로 `createSupabaseVoiceStore`, `createElevenLabs()`를 만들고 `PRESET_KEYS` 각각에 `precomputePresetAudio`를 실행한 뒤 완료를 출력한다.
   - 환경변수 검사 로직은 테스트할 수 있게 분리한다 (스크립트를 import만 해도 실행되는 구조는 피한다).
2. `package.json`에 `"precompute:presets"` 스크립트를 추가한다.
   - 러너는 `tsx`(devDependency). `@/` alias가 풀려야 하고, `server-only`가 throw하지 않도록 `react-server` 조건으로 실행한다(`--conditions=react-server`).
   - `.env.local`이 있으면 읽고 없어도 실패하지 않게 한다(`--env-file-if-exists=.env.local`). tsx가 이 플래그들을 Node에 넘기는지 실제로 확인한다.
3. `eslint.config.mjs`가 `scripts/`를 통째로 무시하고 있다. 새 TS 스크립트가 lint되도록 조정한다 (Python 파일은 원래 ESLint 대상이 아니다).
4. 테스트: 환경변수 검사 — 전부 있음 → 빠진 것 없음, 일부 없음·빈 문자열 → 그 이름들.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
# 키가 비어 있으면 네트워크 호출 없이 실패하고, 빠진 변수 이름을 알려준다 (.env.local이 있어도 빈 값이 우선한다)
ELEVENLABS_API_KEY= ELEVENLABS_PRESET_VOICE_ID= NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= npm run precompute:presets 2>err.txt; test $? -ne 0 && grep -q ELEVENLABS_API_KEY err.txt && grep -q SUPABASE_SERVICE_ROLE_KEY err.txt; rc=$?; rm -f err.txt; exit $rc
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CLAUDE.md CRITICAL: 키는 서버(스크립트 포함 서버 측)에서만, 임의 텍스트 합성 경로 없음
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 실제 키로 스크립트를 실행하지 마라. `.env.local`을 만들지도 마라. 이유: 키가 없고, 있어도 크레딧이 소모된다. 키가 없다는 이유로 `blocked` 처리하지도 마라 — 이 step은 키 없이 완결된다.
- 환경변수 **값**을 출력하지 마라. 이유: 로그에 키가 남는다.
- 스크립트가 문장 텍스트나 voice_id를 인자로 받게 하지 마라. 이유: 합성 대상은 `PHRASES`, 목소리는 `ELEVENLABS_PRESET_VOICE_ID`로만 정한다 — 임의 텍스트 합성 경로가 생긴다.
- `scripts/execute.py`·`scripts/test_execute.py`를 건드리지 마라. 이유: Harness 도구다.
- 기존 테스트를 깨뜨리지 마라.
