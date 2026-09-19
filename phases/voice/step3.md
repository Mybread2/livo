# Step 3: elevenlabs-client

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. ElevenLabs가 TTS와 음성 클로닝을 모두 맡는다 (ADR-001).
API 키는 아직 없다. 실제 호출 없이 **주입한 fake fetch**로 테스트한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/src/lib/phrases.ts` (step 1 — `PhraseId`, `isPhraseId`, `getPhraseText`)
- `/vitest.config.ts`, `/.env.example` (step 0)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/services/elevenlabs.ts` — 서버 전용 래퍼

파일 첫 줄에 `import 'server-only';`를 둔다 (`npm install server-only`). 클라이언트 번들에 들어가면 빌드가 실패하게 하기 위해서다.
Vitest에서는 `server-only`를 빈 모듈로 alias한다 (`vitest.config.ts`의 `resolve.alias`, 빈 스텁 파일 1개).

```ts
export interface ElevenLabsOptions {
  apiKey?: string;          // 기본값 process.env.ELEVENLABS_API_KEY. 없으면 생성 시 throw
  fetch?: typeof fetch;     // 테스트 주입용. 기본값 globalThis.fetch
  modelId?: string;         // 기본값 'eleven_multilingual_v2'
}

export interface ElevenLabs {
  synthesizePhrase(phraseId: PhraseId, voiceId: string): Promise<{ audio: ArrayBuffer; charCount: number }>;
  cloneVoice(input: { name: string; files: Blob[]; description?: string }): Promise<{ voiceId: string }>;
  deleteVoice(voiceId: string): Promise<void>;
}

export function createElevenLabs(options?: ElevenLabsOptions): ElevenLabs;
export class ElevenLabsError extends Error { status: number }
```

핵심 규칙:
- **`synthesizePhrase`는 텍스트를 받지 않는다.** `PhraseId`만 받고, 텍스트는 `getPhraseText(phraseId)`로 찾는다. 런타임에 `isPhraseId`가 false면 fetch를 호출하지 않고 throw한다. 이 모듈의 어떤 export도 임의 문자열을 합성 텍스트로 받지 않는다 (CLAUDE.md CRITICAL: 임의 텍스트 합성 경로 금지).
- API 키를 에러 메시지·로그·반환값에 넣지 않는다.
- 2xx가 아니면 `ElevenLabsError(status)`를 throw한다.

엔드포인트 (구현 전에 공식 API 레퍼런스 https://elevenlabs.io/docs/api-reference 를 WebFetch로 확인하고, 다르면 공식 문서를 따른다):
- TTS: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`, 헤더 `xi-api-key`, JSON `{ text, model_id }` → 오디오 바이트
- Instant Voice Cloning: `POST https://api.elevenlabs.io/v1/voices/add`, multipart (`name`, `files`(여러 개), `remove_background_noise=true`, `description`) → `{ voice_id }`
- 삭제: `DELETE https://api.elevenlabs.io/v1/voices/{voice_id}`

공식 SDK 대신 `fetch`를 직접 쓴다. 이유: 의존성이 줄고 fake fetch 주입으로 테스트가 단순하다.

### 2. 테스트 `src/services/elevenlabs.test.ts`

- `synthesizePhrase('pain', 'v1')` → URL·메서드·`xi-api-key` 헤더·body의 `text === '아파요'`·`model_id` 확인, `charCount === 3`
- `PhraseId`가 아닌 값을 캐스팅해 넣으면 throw하고 fetch는 호출되지 않는다
- `cloneVoice` → multipart에 name·files·`remove_background_noise`가 담기고 `voiceId` 반환
- `deleteVoice` → DELETE 호출
- 4xx/5xx → `ElevenLabsError`, 메시지에 API 키 문자열이 없다
- apiKey 옵션·환경변수가 모두 없으면 `createElevenLabs()`가 throw

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ElevenLabs 호출이 `src/services/`에만 있는가?
   - CLAUDE.md CRITICAL 규칙: 임의 텍스트 합성 경로 없음, 키는 서버에만
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `text: string`을 받는 합성 함수(`synthesize(text, ...)`, `tts(text)` 등)를 만들지 마라, private 헬퍼라도 export하지 마라. 이유: 임의 텍스트 → 음성 경로가 생긴다 (CLAUDE.md CRITICAL).
- 테스트에서 실제 ElevenLabs API를 호출하지 마라. 이유: 키가 없고, 있어도 크레딧이 소모된다.
- 키가 없다는 이유로 `blocked` 처리하지 마라. 이유: 이 step은 fake fetch로 완결된다.
- 기존 테스트를 깨뜨리지 마라.
