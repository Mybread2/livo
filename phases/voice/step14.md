# Step 14: voice-profile-routes

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. step 13에서 라우트 공통 기반(`src/services/api.ts`)을 만들었다.
이 step은 **목소리 등록** 흐름의 라우트 세 개를 만든다. 보호자 화면(A)이 이 순서로 부른다:
업로드 URL 발급 → (클라이언트가 서명 URL로 참조 음성 업로드) → 등록 → (실패 시) 사전 합성 재시도.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (API 표), `/docs/ADR.md`
- `/src/services/api.ts`, `/src/services/api.test.ts` (step 13)
- `/src/services/voice-profile.ts` (`createRefAudioUpload`, `registerVoiceProfile`, `resumePrecompute`)
- `/src/services/testing/memory-voice-store.ts` (테스트용 메모리 store, 시드 헬퍼)
- `/src/app/api/voice-profile/route.ts` — A의 501 스텁. 이 step에서 실제 구현으로 바꾼다

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. 핸들러 `src/services/voice-profile-api.ts` (라우트와 분리해 테스트한다)

```ts
import 'server-only';
export async function handleCreateUpload(ctx: VoiceApiContext, body: Record<string, unknown>): Promise<Response>;
export async function handleRegister(ctx: VoiceApiContext, body: Record<string, unknown>): Promise<Response>;
export async function handleResume(ctx: VoiceApiContext, profileId: string, body: Record<string, unknown>): Promise<Response>;
```

| 라우트 | 요청 본문 | 성공 응답 |
|---|---|---|
| `POST /api/voice-profile/upload-url` | `{ subject_id, source }` | 200 `{ path, signed_url, token }` |
| `POST /api/voice-profile` | `{ subject_id, source, ref_audio_path }` | 201 `{ profile_id, voice_id, preview_url }` |
| `POST /api/voice-profile/[profile_id]/precompute` | `{ subject_id }` | 200 `{ synthesized, skipped }` |

- 입력은 `parseUuid`·`parseSource`로 검증한다. `ref_audio_path`는 문자열이어야 한다 (경로 규칙 검사는 `registerVoiceProfile`이 한다).
- 서버 함수의 오류는 전부 `errorResponse`로 바꾼다.
- **요청 본문에 텍스트·문장·voice_id 필드를 받지 않는다.** 알 수 없는 필드는 무시한다.

### 2. 라우트 파일 (각각 `export const runtime = "nodejs"`)

- `src/app/api/voice-profile/upload-url/route.ts`
- `src/app/api/voice-profile/route.ts` — A의 스텁을 대체. `export const maxDuration = 60` (클론 + 15문장 순차 합성)
- `src/app/api/voice-profile/[profile_id]/precompute/route.ts` — `maxDuration = 60`

라우트 본문은 이 형태를 넘지 않는다:
```ts
const ctx = await getVoiceApiContext();
if (ctx instanceof Response) return ctx;
try { return await handleX(ctx, await readJsonObject(req)); } catch (err) { return errorResponse(err); }
```

### 3. 테스트 `src/services/voice-profile-api.test.ts` (메모리 store + fake tts)

- 업로드 URL: 정상 → 200과 `path`가 `'{subject_id}/'`로 시작. 동의 없음 → 409 `missing`. 남의 대상자 → 403. `source: 'preset'` → 400
- 등록: 정상 → 201, 프로필 생성. 사전 합성 도중 실패 → 502 `{ error: 'precompute_incomplete', profile_id }`
- 재시도: 그 `profile_id`로 → 200, 남은 문장만 합성. 잘못된 uuid → 400
- 본문에 `text` 필드를 넣어도 합성 문장은 `PHRASES`뿐이다 (fake tts가 받은 phraseId가 전부 등록 id)

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 라우트는 얇은 래퍼인가 (권한·동의 규칙이 라우트에 없는가)?
   - CLAUDE.md CRITICAL: 임의 텍스트 합성 경로 없음, 동의 없는 음성 처리 없음, 키는 서버에만
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 라우트에서 텍스트를 받아 합성하는 경로를 만들지 마라. 이유: CLAUDE.md CRITICAL.
- 실제 Supabase·ElevenLabs를 호출하지 마라 (`.env.local`에 키가 있어도). 이유: 테스트는 fake로 완결되고, 실제 호출은 크레딧·슬롯을 쓴다.
- 보호자 화면(`src/app/(caregiver)/`)을 고치지 마라. 이유: A 담당이다.
- 기존 테스트를 깨뜨리지 마라.
