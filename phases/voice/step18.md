# Step 18: voice-preset-routes

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. step 16~17에서 목소리 팔레트와 대상자별 선택을 서버 함수로 만들었다.
이 step은 보호자 화면(A)이 부를 라우트 두 개를 만들고 `docs/ARCHITECTURE.md`를 갱신한다. 라우트는 step 13~15와 같은 얇은 래퍼다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (API 표 — 갱신), `/docs/ADR.md`
- `/src/services/api.ts` (`getVoiceApiContext`, `errorResponse`, `parseUuid`, `readJsonObject`)
- `/src/services/bundle-purge-api.ts`, `/src/app/api/subjects/[subject_id]/route.ts` (기존 라우트 형식)
- `/src/services/voice-preset.ts` (step 17 — `listVoicePresets`, `selectVoicePreset`)
- `/src/services/testing/memory-voice-store.ts`

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. 핸들러 `src/services/voice-preset-api.ts`

```ts
import 'server-only';
export async function handleListPresets(ctx: VoiceApiContext): Promise<Response>;
export async function handleSelectPreset(ctx: VoiceApiContext, subjectId: string, body: Record<string, unknown>): Promise<Response>;
```

| 라우트 | 요청 | 성공 응답 |
|---|---|---|
| `GET /api/voice-presets` | — (로그인 필요) | 200 `{ presets: [{ key, label, gender, age_band, preview_url }] }` + `Cache-Control: no-store` |
| `PUT /api/subjects/[subject_id]/voice-preset` | `{ preset_key }` | 200 `{ preset_key }` |

- 응답에 voice_id를 넣지 않는다.
- 오류는 `errorResponse`로 바꾼다 (잘못된 키·미완성 → 400, 남의 대상자 → 403).

### 2. 라우트 파일 (`export const runtime = "nodejs"`)

- `src/app/api/voice-presets/route.ts` — `GET`
- `src/app/api/subjects/[subject_id]/voice-preset/route.ts` — `PUT`

### 3. 테스트 `src/services/voice-preset-api.test.ts` (메모리 store)

- 목록: 완성된 프리셋만, snake_case 필드, `no-store`, 본문에 voice_id 없음
- 선택: 200 · 잘못된 uuid 400 · 잘못된 키 400 · 남의 대상자 403

### 4. `docs/ARCHITECTURE.md`

- API 표에 두 라우트를 추가한다.
- "목소리" 관련 서술에 팔레트를 반영한다: 무료 플랜에서는 클로닝·Voice Design API가 막혀 있어, 성별·연령대 프리셋 6개를 웹에서 만들어 사전 합성하고 대상자별로 고른다. 클로닝 경로(`/api/voice-profile`)는 유료 전환 또는 자체 호스팅 모델용으로 남아 있다.
- 데이터 모델 표의 `subjects`에 `voice_preset`을 추가한다.
- 문서는 200줄 이하.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
wc -l docs/ARCHITECTURE.md   # 200줄 이하
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 라우트는 얇은 래퍼인가?
   - CLAUDE.md CRITICAL: 응답에 voice_id 없음, 임의 텍스트 합성 경로 없음
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 보호자 화면(`src/app/(caregiver)/`)을 만들거나 고치지 마라. 이유: A 담당이다.
- 실제 Supabase·ElevenLabs를 호출하지 마라. 이유: 테스트는 fake로 완결된다.
- 기존 테스트를 깨뜨리지 마라.
