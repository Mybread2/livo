# Step 5: voice-registration

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. 보호자가 참조 음성(가족 또는 본인 옛 음성)을 올리면
동의를 확인하고 → ElevenLabs에 클로닝 voice를 등록하고 → `voice_profiles`에 저장하고 → 고정 문장 전체를 사전 합성한다.
이것이 `POST /api/voice-profile`의 본체다. 라우트는 Next.js 골격(A 담당)이 올라온 뒤 이 함수를 감싸는 얇은 래퍼로 만든다.
키가 없으므로 메모리 store와 fake tts로 테스트한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md`, `/docs/ADR.md` (ADR-008 동의를 스키마로 강제)
- `/supabase/migrations/20260919000000_voice_schema.sql` (step 2 — `consents.kind`, `voice_profiles`, bucket)
- `/src/services/elevenlabs.ts` (step 3)
- `/src/services/voice-store.ts`, `/src/services/testing/memory-voice-store.ts`, `/src/services/precompute.ts` (step 4)
- `/src/lib/phrases.ts` (step 1)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `VoiceStore`에 메서드 추가 (Supabase 구현 + 메모리 구현 둘 다)

```ts
ownsSubject(userId: string, subjectId: string): Promise<boolean>;     // subjects ⨝ accounts.user_id
listActiveConsents(subjectId: string): Promise<{ id: string; kind: ConsentKind; grantedAt: string }[]>;  // revoked_at is null
createRefUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;  // 'voice-refs' bucket
downloadRef(path: string): Promise<Blob>;
deleteRef(path: string): Promise<void>;
insertVoiceProfile(row: { subjectId: string; source: VoiceSource; refAudioPath: string; providerVoiceId: string; consentId: string }): Promise<{ id: string }>;
clearRefAudioPath(voiceProfileId: string): Promise<void>;
signedAudioUrl(path: string, expiresInSec: number): Promise<string>;  // 'phrase-audio' bucket
```
메모리 구현에는 계정·대상자·동의를 시드하는 테스트용 헬퍼를 둔다.

### 2. `src/services/voice-profile.ts`

```ts
export type VoiceSource = 'self' | 'family';     // 'preset'은 없다 — 프리셋은 voice_profiles에 넣지 않는다
export class ForbiddenError extends Error {}
export class ConsentRequiredError extends Error { missing: ConsentKind[] }

export async function createRefAudioUpload(
  deps: { store: VoiceStore },
  input: { userId: string; subjectId: string; source: VoiceSource },
): Promise<{ path: string; signedUrl: string; token: string }>;
  // 소유·동의 확인 후 경로 '{subjectId}/{randomUUID}'의 서명 업로드 URL 발급

export async function registerVoiceProfile(
  deps: { store: VoiceStore; tts: Pick<ElevenLabs, 'cloneVoice' | 'deleteVoice' | 'synthesizePhrase'> },
  input: { userId: string; subjectId: string; source: VoiceSource; refAudioPath: string },
): Promise<{ profile_id: string; voice_id: string; preview_url: string }>;
```

`registerVoiceProfile` 순서와 규칙:
1. `ownsSubject`가 false → `ForbiddenError`. 이후 아무것도 호출하지 않는다.
2. `refAudioPath`가 `'{subjectId}/'`로 시작하지 않으면 → `ForbiddenError`. 다른 대상자의 음성을 끌어다 쓰지 못하게 한다.
3. **동의 확인** (철회되지 않은 것만): `source === 'self'`면 `voice_self`, `'family'`면 `voice_family`, 그리고 둘 다 `overseas_transfer`(해외 API 전송)가 필요하다. 없으면 `ConsentRequiredError(missing)`를 던지고, ElevenLabs를 호출하지 않는다. `family`는 `voice_self`로 대신할 수 없다 — 가족 음성은 가족 본인 동의가 필요하다.
4. `downloadRef` → `cloneVoice({ name: 'livo-{subjectId}', files: [blob] })`. voice 이름에 대상자 이름 같은 개인정보를 넣지 않는다.
5. `insertVoiceProfile` — `consentId`는 3에서 찾은 `voice_self`/`voice_family` 동의 중 가장 최근 것. insert가 실패하면 `deleteVoice(voiceId)`로 슬롯을 회수하고 다시 throw한다.
6. **원본 파기**: 철회되지 않은 `voice_retention` 동의가 없으면 `deleteRef` + `clearRefAudioPath`. 있으면 보관한다 (기획서 §6.3).
7. `precomputeProfileAudio`로 5문장 사전 합성.
8. `preview_url` = `PHRASES[0]`의 사전 합성 오디오에 대한 `signedAudioUrl`(600초). 미리듣기도 등록 문장으로만 한다 — 임의 텍스트 미리듣기는 없다.

`createRefAudioUpload`도 1(소유)과 3(동의)을 똑같이 확인한다 — 동의 없이 참조 음성을 받지 않는다.

### 3. 테스트 `src/services/voice-profile.test.ts`

- self + (`voice_self`, `overseas_transfer`): 반환값이 채워지고, 프로필의 `consentId`가 `voice_self` 동의 id, `phrase_audio` 5행, 원본이 삭제되고 경로는 null
- `voice_retention` 동의가 있으면 원본을 유지한다
- `overseas_transfer`가 없거나 `voice_self`가 철회됐으면 → `ConsentRequiredError`, `cloneVoice` 0회
- family 등록에 `voice_self`만 있으면 → `ConsentRequiredError(['voice_family'])`
- 남의 대상자 → `ForbiddenError`, store 쓰기 0회, tts 0회
- 다른 대상자 경로의 `refAudioPath` → `ForbiddenError`
- `insertVoiceProfile` 실패 → `deleteVoice`가 클론된 voice_id로 호출된다
- `createRefAudioUpload`: 소유·동의 규칙이 같고, path가 `'{subjectId}/'`로 시작한다

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - CLAUDE.md CRITICAL: 동의 레코드 없이 음성 처리 없음, `consent_id` NOT NULL, 임의 텍스트 합성·미리듣기 없음, 키는 서버에만
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 동의 확인 전에 참조 음성을 내려받거나 ElevenLabs를 호출하지 마라. 이유: 동의 없는 생체정보 처리다 (CLAUDE.md CRITICAL).
- 입력으로 `text`나 미리듣기 문장을 받지 마라. 이유: 임의 텍스트 합성 경로가 된다.
- 권한 검사를 호출자(라우트)에 맡기지 마라. 이유: 라우트는 얇은 래퍼여야 하고, 규칙이 한 곳에 있어야 테스트로 지킬 수 있다.
- API 라우트(`src/app/api/`)를 만들지 마라. 이유: Next.js 골격(A 담당)이 아직 없다.
- 기존 테스트를 깨뜨리지 마라.
