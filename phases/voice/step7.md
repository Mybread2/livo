# Step 7: voice-player

## 배경

이 phase는 C 담당(텍스트 → 목소리) 작업이다. A(화면)는 인식 결과 게이트가 `speak`이면 `voicePlayer.speak(phraseId)`를 호출한다.
이 step은 그 `VoicePlayer`(A ↔ C 계약)의 단말 구현이다. 사전 합성 오디오를 단말에 저장해 두고, **발화 순간에는 네트워크 없이** 재생한다.
발화 지연 예산은 약 0.6초다. 브라우저 API(Cache Storage, Audio)는 주입받아 Node 환경의 fake로 테스트한다.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (상태 관리 — 오프라인 자산, 교체 중 이전 오디오 유지), `/docs/ADR.md` (ADR-002)
- `/src/types/voice.ts` (step 1 — `VoicePlayer` 계약)
- `/src/types/voice-bundle.ts` (step 6 — `VoiceBundle`)
- `/src/lib/phrases.ts` (step 1)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/offline/voice-player.ts`

```ts
export interface AudioOutput {
  play(audio: Blob): Promise<void>;   // 재생이 끝나면 resolve
  stop(): void;                       // 재생 중인 것을 멈춘다
}

export interface VoicePlayerDeps {
  fetchBundle: () => Promise<VoiceBundle>;   // 통합 시 A가 GET /api/bundle/:subject_id 로 연결
  fetch?: typeof fetch;                       // 오디오 다운로드용. 기본 globalThis.fetch
  cache?: CacheStorage;                       // 기본 globalThis.caches
  output?: AudioOutput;                       // 기본: HTMLAudioElement + object URL
}

export interface SyncableVoicePlayer extends VoicePlayer {
  sync(): Promise<void>;                      // 번들을 받아 단말 저장소를 갱신
}

export async function createVoicePlayer(deps: VoicePlayerDeps): Promise<SyncableVoicePlayer>;
export class VoiceNotReadyError extends Error {}
```

규칙:
- **저장**: Cache Storage 한 곳(`'livo-voice'`)에 버전별 키 `/livo-voice/{version}/{phraseId}`로 오디오를, `/livo-voice/active`에 활성 버전 manifest(`{ version, phraseIds }`)를 둔다. 서명 URL은 매번 바뀌므로 키로 쓰지 않는다.
- **생성 시**: manifest가 있으면 활성 버전 오디오를 메모리(`Map<phraseId, Blob>`)에 올린다. 발화 순간에 저장소를 뒤지지 않게 해 0.6초 예산을 지키기 위해서다. 생성 과정에서 `fetchBundle`이나 `fetch`를 호출하지 않는다.
- **`sync()`**: 번들을 받고, 활성 버전과 같고 모든 문장이 준비돼 있으면 아무것도 하지 않는다. 버전이 다르면 새 버전 항목을 **전부** 내려받은 뒤에만 manifest와 메모리를 새 버전으로 바꾸고 이전 버전 키를 지운다. 하나라도 실패하면 throw하고 이전 버전을 그대로 둔다 — 목소리 교체 중에도 발화가 끊기지 않게 하기 위해서다.
- **`isReady(phraseId)`**: 메모리에 그 문장 오디오가 있으면 true.
- **`speak(phraseId)`**: **`fetch`·`fetchBundle`을 절대 호출하지 않는다.** 준비 안 됐으면 `VoiceNotReadyError`로 reject한다. 재생 중에 새 `speak`가 오면 이전 재생을 `stop()`하고 새것을 재생한다 (최신 우선).
- 기본 `AudioOutput`은 `new Audio(URL.createObjectURL(blob))`로 재생하고 끝나면 object URL을 revoke한다. 브라우저 전용이라 단위 테스트에서는 fake를 주입한다.

### 2. 테스트 `src/offline/voice-player.test.ts` (Node 환경, 메모리 CacheStorage fake + 호출 기록 fake fetch·output)

- 빈 저장소 → 모든 `isReady` false, `speak('pain')` → `VoiceNotReadyError`
- `sync()`(preset 번들) 후 → 전부 ready, `speak('pain')`이 그 문장의 오디오 Blob으로 `output.play` 호출
- **`speak` 동안 fetch·fetchBundle 호출 수가 늘지 않는다**
- 같은 cache로 새 player를 만들면 네트워크 호출 없이 ready (오프라인 재시작)
- 활성 v1 상태에서 v2 sync 중 한 항목 다운로드 실패 → throw, 여전히 v1 오디오로 재생
- 이어서 v2 sync 성공 → v2 오디오로 재생, v1 키가 cache에서 지워진다
- 같은 버전으로 다시 sync → 오디오 다운로드 0회
- 재생 중 두 번째 `speak` → 첫 재생에 `stop()`이 호출된다

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md: 오프라인 자산은 단말 저장소, 교체 중 이전 오디오 유지 (`src/offline/`)
   - CLAUDE.md CRITICAL: 고정 문장 발화 경로는 네트워크 없이 끝난다
3. 결과에 따라 `phases/voice/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `speak`에서 오디오를 스트리밍하거나 서버에 합성을 요청하지 마라. 이유: 고정 문장 발화 경로는 네트워크 왕복 0회여야 한다 (ADR-002).
- `speak` 전에 안내음·확인 절차를 넣지 마라. 이유: 대상자 화면은 손 없이 완결되고, 응급 발화 앞 안내음은 금지다 (docs/UI_GUIDE.md).
- `src/types/voice.ts`의 `VoicePlayer` 시그니처를 바꾸지 마라. 이유: 3인 합의 계약이다.
- 화면 컴포넌트(`<AudioPlayer>` 등)를 만들지 마라. 이유: A 담당 어댑터다.
- jsdom·happy-dom을 설치하지 마라. 이유: 브라우저 API는 주입받으므로 Node fake로 충분하다.
- 기존 테스트를 깨뜨리지 마라.
