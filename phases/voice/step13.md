# Step 13: api-foundation

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. step 0~12에서 서버 함수(등록·사전 합성·번들·파기)를 프레임워크 없이 만들었고,
이제 A(프론트)가 올린 Next.js 14 App Router 골격과 합쳐졌다. step 13~15는 서버 함수를 **얇은 API 라우트**로 노출한다.
이 step은 라우트들이 공통으로 쓰는 기반 — 서비스 의존성 생성, 로그인 사용자 확인, 에러 → HTTP 응답 변환, 입력 검증 — 을 만든다.
권한·동의 규칙은 이미 서버 함수 안에 있다. 라우트와 이 기반은 그 규칙을 다시 구현하지 않는다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (API 표), `/docs/ADR.md`
- `/src/lib/supabase/server.ts` — A의 `getSupabaseServerClient()` (쿠키 세션, env 없으면 null)
- `/src/services/voice-store.ts` (`createSupabaseVoiceStore`), `/src/services/elevenlabs.ts` (`createElevenLabs`, `ElevenLabsError`)
- `/src/services/voice-profile.ts` (`ForbiddenError`, `ConsentRequiredError`, `PrecomputeIncompleteError`, `VoiceSource`)
- `/src/app/api/voice-profile/route.ts`, `/src/app/api/bundle/[subject_id]/route.ts` — A의 스텁 (형식 참고, 이 step에서는 수정하지 않는다)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/services/supabase-admin.ts`

```ts
import 'server-only';
export function createSupabaseAdmin(): SupabaseClient;  // NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, persistSession·autoRefreshToken false. 없으면 throw
```
service role 키는 RLS를 우회한다. 이 클라이언트는 `VoiceStore` 안에서만 쓰고, 권한 판단은 서버 함수의 `ownsSubject`가 한다.

### 2. `src/services/api.ts` — 라우트 공통 기반

```ts
import 'server-only';

export interface VoiceApiContext { userId: string; store: VoiceStore; tts: ElevenLabs }

export class BadRequestError extends Error {}
export function parseUuid(value: unknown, field: string): string;      // uuid 형식 아니면 BadRequestError
export function parseSource(value: unknown): VoiceSource;             // 'self' | 'family'만. 'preset' 포함 나머지는 BadRequestError
export async function readJsonObject(req: Request): Promise<Record<string, unknown>>;  // JSON 객체가 아니면 BadRequestError

export function errorResponse(err: unknown): Response;
export async function getVoiceApiContext(): Promise<VoiceApiContext | Response>;
```

`errorResponse` 매핑 (본문은 `{ error: <code>, ... }` JSON):

| 오류 | 상태 | 본문 |
|---|---|---|
| `BadRequestError` | 400 | `{ error: 'bad_request' }` |
| `ForbiddenError` | 403 | `{ error: 'forbidden' }` |
| `ConsentRequiredError` | 409 | `{ error: 'consent_required', missing }` |
| `PrecomputeIncompleteError` | 502 | `{ error: 'precompute_incomplete', profile_id }` — 클라이언트가 재시도에 쓴다 |
| `ElevenLabsError` | 502 | `{ error: 'upstream' }` |
| 그 외 | 500 | `{ error: 'internal' }` |

오류 메시지·스택·키·서명 URL을 응답 본문에 넣지 않는다. 500은 서버 로그(`console.error`)에만 남긴다.

`getVoiceApiContext`:
- `getSupabaseServerClient()`가 null(환경변수 없음) → 503 `{ error: 'not_configured' }`
- `supabase.auth.getUser()`로 사용자를 얻는다. 없으면 401 `{ error: 'unauthorized' }`. (`getSession()`이 아니라 `getUser()` — 쿠키만 믿지 않고 Supabase에 토큰을 검증받는다)
- 있으면 `{ userId, store: createSupabaseVoiceStore(createSupabaseAdmin()), tts: createElevenLabs() }`

### 3. 테스트 `src/services/api.test.ts`

- `errorResponse`: 표의 각 오류 → 상태·본문. 본문에 원래 오류 메시지 문자열이 들어 있지 않다
- `parseUuid`·`parseSource`·`readJsonObject`: 정상값 통과, 잘못된 값(빈 문자열, 'preset', 숫자, 배열 JSON, 깨진 JSON) → `BadRequestError`
- `getVoiceApiContext`: `vi.mock('@/lib/supabase/server')`로 null → 503, 사용자 없음 → 401, 사용자 있음 → `userId`가 채워진 컨텍스트 (admin·ElevenLabs 생성은 env를 테스트용 값으로 채우거나 mock한다. 실제 네트워크 호출 금지)

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 서버 코드가 `src/services/`에 있고 `server-only`를 import하는가?
   - CLAUDE.md CRITICAL: 키는 서버에만, 임의 텍스트 합성 경로 없음
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 라우트 파일(`src/app/api/`)을 이 step에서 만들거나 고치지 마라. 이유: 라우트는 step 14·15다.
- 권한·동의 검사를 여기서 다시 구현하지 마라. 이유: 규칙은 서버 함수(`src/services/voice-profile.ts` 등) 한 곳에 있어야 테스트로 지킬 수 있다.
- `.env.local`의 실제 키로 Supabase·ElevenLabs를 호출하지 마라. 이유: 테스트는 fake로 완결된다. 실제 키가 있다고 해서 쓰지 않는다.
- A의 파일(`src/lib/supabase/*`, `src/app/*`)을 고치지 마라. 이유: A 담당이다.
- 기존 테스트를 깨뜨리지 마라.
