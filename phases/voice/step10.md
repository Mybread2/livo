# Step 10: voice-purge

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. 기획서 §6.3·ARCHITECTURE 보관 규칙: 참조 음성과 목소리는 **요청 시 즉시 파기**, **계정 삭제 시 연쇄 파기**.
지금은 철회·삭제 시 아무것도 지우지 않는다. DB cascade는 행만 지우고 Storage 파일과 ElevenLabs voice는 남기며, 행이 사라지면 지울 경로도 잃는다.
step 8에서 클라이언트의 직접 철회(consents update)·대상자 삭제(subjects delete)를 막았다. 이 step은 그것을 대신할 **서버 함수**를 만든다.
API 라우트는 Next.js 골격(A 담당)이 올라온 뒤 얇은 래퍼로 만든다. 키가 없으므로 메모리 store와 fake tts로 테스트한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (보관 규칙), `/docs/ADR.md` (ADR-008)
- `/supabase/migrations/` (두 파일 — 테이블·FK·cascade, step 8의 정책 변경)
- `/src/services/voice-store.ts`, `/src/services/testing/memory-voice-store.ts`
- `/src/services/voice-profile.ts` (`ForbiddenError`, `createRefAudioUpload`가 만드는 참조 음성 경로 `'{subjectId}/{uuid}'`)
- `/src/services/precompute.ts` (사전 합성 오디오 경로), `/src/services/elevenlabs.ts` (`deleteVoice`, `ElevenLabsError.status`)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `VoiceStore`에 메서드 추가 (Supabase 구현 + 메모리 구현)

```ts
getVoiceProfile(id: string): Promise<{ id: string; subjectId: string; source: VoiceSource; providerVoiceId: string; consentId: string; refAudioPath: string | null } | null>;
getConsent(id: string): Promise<{ id: string; subjectId: string; kind: ConsentKind; revokedAt: string | null } | null>;
revokeConsent(id: string, at: Date): Promise<void>;   // revoked_at이 null일 때만 설정 — 최초 철회 시각을 덮어쓰지 않는다
deleteAudio(paths: string[]): Promise<void>;           // 'phrase-audio' bucket
listRefs(subjectId: string): Promise<string[]>;        // 'voice-refs' bucket의 '{subjectId}/' 아래 전부 (등록되지 않은 업로드 포함)
deleteVoiceProfile(id: string): Promise<void>;         // phrase_audio 행은 FK cascade
deleteSubject(subjectId: string): Promise<void>;       // consents·voice_profiles·phrase_audio 행은 FK cascade
```

### 2. `src/services/purge.ts`

```ts
type PurgeDeps = { store: VoiceStore; tts: Pick<ElevenLabs, 'deleteVoice'>; now?: () => Date };

export async function purgeVoiceProfile(deps: PurgeDeps, voiceProfileId: string): Promise<void>;
export async function revokeConsent(deps: PurgeDeps, input: { userId: string; consentId: string }): Promise<{ purgedProfileIds: string[] }>;
export async function deleteSubject(deps: PurgeDeps, input: { userId: string; subjectId: string }): Promise<void>;
```

`purgeVoiceProfile` — 한 프로필의 목소리를 전부 파기한다. **멱등**이어야 한다 (중간 실패 후 다시 부르면 이어서 끝낸다):
1. 프로필이 없으면 아무것도 안 하고 끝낸다.
2. `tts.deleteVoice(providerVoiceId)`. `ElevenLabsError`의 status가 404면 이미 지워진 것으로 보고 계속한다. 다른 오류는 throw.
3. 그 프로필의 사전 합성 오디오 파일을 `deleteAudio`로 지운다 (`listPhraseAudio`의 `audioPath`들).
4. 보관 중인 참조 음성(`refAudioPath`)이 있으면 `deleteRef`.
5. **마지막에** `deleteVoiceProfile`. 행을 먼저 지우면 실패 시 지울 대상(voice_id·경로)을 잃는다.

`revokeConsent`:
1. 동의가 없거나 `ownsSubject(userId, consent.subjectId)`가 false면 `ForbiddenError` (존재 여부를 드러내지 않는다).
2. **파기보다 먼저** `revokeConsent(id, now())`. 파기가 실패해도 철회는 기록되고, 번들(step 9)은 이미 그 목소리를 내보내지 않는다.
3. 동의 종류별 파기:
   - `voice_self` / `voice_family` → 그 `consentId`를 가진 프로필 전부 `purgeVoiceProfile`
   - `overseas_transfer` → 대상자의 프로필 전부 `purgeVoiceProfile` (클로닝 목소리는 해외 API에 있다 — 보수적으로 전부 파기)
   - `voice_retention` → `listRefs(subjectId)` 전부 `deleteRef`, 모든 프로필의 `clearRefAudioPath`
   - 그 외 종류 → 철회 기록만
4. 이미 철회된 동의에 다시 불러도 3을 다시 수행한다 — 파기 실패 후 재시도 경로다.

`deleteSubject`:
1. `ownsSubject`가 false면 `ForbiddenError`.
2. 대상자의 프로필 전부 `purgeVoiceProfile`.
3. `listRefs(subjectId)` 전부 `deleteRef` — 업로드만 되고 등록되지 않은 참조 음성도 남기지 않는다.
4. **마지막에** `store.deleteSubject`.

### 3. 테스트 `src/services/purge.test.ts`

- `purgeVoiceProfile`: voice 삭제·오디오 파일·보관 원본·행이 모두 사라진다. `deleteVoice`가 404면 계속 진행, 500이면 throw하고 **행은 남는다**. 두 번 불러도 안전하다
- `revokeConsent(voice_family)`: 그 동의의 프로필만 파기, 다른 동의(`voice_self`)의 프로필은 남는다. `revokedAt`이 기록된다
- `revokeConsent(overseas_transfer)`: 대상자의 프로필 전부 파기
- `revokeConsent(voice_retention)`: 참조 음성 파일 전부 삭제, 프로필은 남고 `refAudioPath`는 null
- `revokeConsent(biometric)`: 철회 기록만, 파기 호출 0회
- 파기 중 `deleteVoice`가 실패해도 `revokedAt`은 기록돼 있다. 다시 부르면 파기가 끝나고 최초 `revokedAt`은 바뀌지 않는다
- 남의 동의 → `ForbiddenError`, 쓰기 0회
- `deleteSubject`: 프로필·오디오·원본·**등록 안 된 업로드**가 모두 지워지고 대상자 행이 사라진다. 남의 대상자 → `ForbiddenError`

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 서버 코드가 `src/services/`에 있고 `server-only`를 import하는가?
   - CLAUDE.md CRITICAL: 동의 없는 음성 처리 금지, 모든 테이블 RLS
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 파기할 대상을 찾기 전에 DB 행(프로필·대상자)을 지우지 마라. 이유: 행이 사라지면 ElevenLabs voice_id와 Storage 경로를 잃어 영영 못 지운다.
- 동의 행을 지우지 마라. 이유: 동의는 철회로만 기록한다 (감사 추적). 대상자 삭제 시의 cascade는 예외다.
- 파기 실패를 삼키지 마라 (404 제외). 이유: 호출자가 재시도해야 하는지 알아야 한다.
- 계정 삭제(`auth.users`) 함수를 만들지 마라. 이유: 계정에는 다른 담당(B의 학습 데이터 등)의 데이터도 있어 계정 삭제 흐름은 팀이 정한다. C는 `deleteSubject`를 제공한다.
- API 라우트(`src/app/api/`)를 만들지 마라. 이유: Next.js 골격(A 담당)이 아직 없다.
- 기존 테스트를 깨뜨리지 마라.
