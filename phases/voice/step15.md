# Step 15: bundle-purge-routes

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. step 13에서 라우트 공통 기반, step 14에서 목소리 등록 라우트를 만들었다.
이 step은 나머지 세 라우트 — **번들 다운로드**, **동의 철회**, **대상자 삭제** — 를 만들고 `docs/ARCHITECTURE.md`의 API 표를 갱신한다.
동의 철회와 대상자 삭제는 DB 정책상 클라이언트가 직접 할 수 없다 (목소리 파기를 동반해야 해서 서버 전용). 이 라우트가 유일한 경로다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (API 표 — 이 step에서 갱신), `/docs/ADR.md`
- `/src/services/api.ts` (step 13), `/src/services/voice-profile-api.ts` (step 14 — 핸들러 형식)
- `/src/services/bundle.ts` (`getBundle`), `/src/services/purge.ts` (`revokeConsent`, `deleteSubject`)
- `/src/types/voice-bundle.ts`
- `/src/app/api/bundle/[subject_id]/route.ts` — A의 스텁. 이 step에서 실제 구현으로 바꾼다

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. 핸들러 `src/services/bundle-purge-api.ts`

```ts
import 'server-only';
export async function handleBundle(ctx: VoiceApiContext, subjectId: string): Promise<Response>;
export async function handleRevokeConsent(ctx: VoiceApiContext, consentId: string): Promise<Response>;
export async function handleDeleteSubject(ctx: VoiceApiContext, subjectId: string): Promise<Response>;
```

| 라우트 | 성공 응답 |
|---|---|
| `GET /api/bundle/[subject_id]` | 200 `{ voice: VoiceBundle, recognizer: null }` + `Cache-Control: no-store` |
| `POST /api/consents/[consent_id]/revoke` | 200 `{ purged_profile_ids }` |
| `DELETE /api/subjects/[subject_id]` | 204 |

- 경로 파라미터는 `parseUuid`로 검증한다. 오류는 `errorResponse`로 바꾼다.
- 번들 응답의 `recognizer`는 B 담당(인식기 번들) 자리다. `null`로 둔다.
- 번들에는 서명 URL이 있어 캐시되면 안 된다 (`no-store`).

### 2. 라우트 파일 (각각 `export const runtime = "nodejs"`, 형태는 step 14 라우트와 같다)

- `src/app/api/bundle/[subject_id]/route.ts` — A의 스텁을 대체
- `src/app/api/consents/[consent_id]/revoke/route.ts` — `maxDuration = 60` (여러 프로필 파기)
- `src/app/api/subjects/[subject_id]/route.ts` — `DELETE`만. `maxDuration = 60`

### 3. 테스트 `src/services/bundle-purge-api.test.ts` (메모리 store + fake tts)

- 번들: 정상 → 200, `voice.items`가 `PHRASES` 수만큼, `Cache-Control: no-store`, 본문에 `provider_voice_id`·참조 음성 경로 없음. 남의 대상자 → 403. 잘못된 uuid → 400
- 철회: 음성 동의 철회 → 200과 파기된 프로필 id. 남의 동의 → 403
- 삭제: → 204, 대상자·프로필이 사라짐. 남의 대상자 → 403

### 4. `docs/ARCHITECTURE.md` API 표 갱신

C가 만든 라우트를 표에 맞춘다: `POST /api/voice-profile/upload-url`, `POST /api/voice-profile`(요청은 `subject_id, source, ref_audio_path` — 동의는 서버가 찾는다), `POST /api/voice-profile/[profile_id]/precompute`, `GET /api/bundle/:subject_id`(응답 `{ voice, recognizer }`), `POST /api/consents/[consent_id]/revoke`, `DELETE /api/subjects/[subject_id]`.
철회·대상자 삭제가 서버 전용인 이유를 비고에 한 줄로 적는다. 문서는 200줄을 넘기지 않는다.

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
wc -l docs/ARCHITECTURE.md   # 200줄 이하
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 라우트는 얇은 래퍼인가?
   - CLAUDE.md CRITICAL: 번들에 voice_id 없음, 동의 없는 음성 처리 없음, 모든 테이블 RLS 유지
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 번들 응답에 인식기(템플릿·ONNX)를 넣지 마라. 이유: B 담당이다. `recognizer: null` 자리만 둔다.
- 계정 삭제 라우트를 만들지 마라. 이유: 계정에는 다른 담당의 데이터도 있어 팀이 흐름을 정한다.
- 실제 Supabase·ElevenLabs를 호출하지 마라 (`.env.local`에 키가 있어도). 이유: 테스트는 fake로 완결된다.
- 대상자 화면(`src/app/(subject)/`)의 `MockVoicePlayer`를 교체하지 마라. 이유: 통합은 A 담당이다.
- 기존 테스트를 깨뜨리지 마라.
