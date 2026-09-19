# Step 9: lip-recognizer

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. A ↔ B 계약(`src/types/recognition.ts`)의 `Recognizer`를 실제로 구현한다.
지금까지 만든 것: 순수 파이프라인 `RecognitionPipeline`(얼굴 점 한 프레임 → `RecognitionEvent | null`),
MediaPipe 래퍼 `createLipLandmarker`, 기기 템플릿 저장소 `loadTemplates`. 이 step은 카메라를 켜고, 프레임마다 얼굴 점을 뽑아
파이프라인에 흘리고, 결과를 콜백으로 보내는 브라우저 접착부(`LipRecognizer`)를 만든다.

계약상 동작 (A의 `MockRecognizer`와 같게):
- `start(video, onResult, options?)`: 카메라를 **직접** 켠다(`getUserMedia` → `video.srcObject`). 화면의 `<video>`는 숨김(`display: none`).
- 결과는 **discard 포함** `onResult`로 보낸다. `options.manualSession`이면 게이트 speak 문턱 0.80.
- `stop()`: 인식을 멈추고 카메라 트랙을 끈다 (수동 세션 OFF · 화면 이탈).
- 대상자 화면은 `void recognizer.start(...)`로 호출한다 — **start는 reject하지 않는다**(오류는 경고로 남기고 정리).

안전 원칙: 템플릿이 없으면 아무것도 말하지 않는다(가짜 결과 금지). 애매하면 안 나오는 쪽.

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/src/types/recognition.ts`, `/src/recognition/mockRecognizer.ts` (계약·기존 목 — 읽기만)
- `/src/recognition/pipeline.ts`, `/src/recognition/landmarker.ts`, `/src/offline/templateStore.ts` 와 테스트
- `/CLAUDE.md` (CRITICAL: `src/recognition/` 네트워크 금지, 카메라 프레임 반출 금지)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/recognition/camera.ts`

```ts
export interface CameraHandle {
  stream: MediaStream;
  /** 트랙을 모두 끄고, video.srcObject가 이 스트림이면 비운다. 여러 번 불러도 된다. */
  stop(): void;
}
/** 전면 카메라를 켜 video에 붙이고 재생한다. 소리는 받지 않는다. */
export function openCamera(video: HTMLVideoElement): Promise<CameraHandle>;
```

- `navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false })`.
- `video.muted = true; video.playsInline = true; video.srcObject = stream; await video.play()`.

### 2. `src/recognition/lipRecognizer.ts`

```ts
import type { Recognizer, RecognitionEvent, RecognizerOptions } from "@/types/recognition";
import type { TemplateSet } from "./dtw";
import type { LipLandmarker } from "./landmarker";
import type { CameraHandle } from "./camera";
import type { PipelineOptions } from "./pipeline";

export interface LipRecognizerDeps {
  loadTemplates?: () => Promise<TemplateSet | null>;          // 기본: src/offline/templateStore의 loadTemplates
  createLandmarker?: () => Promise<LipLandmarker>;            // 기본: createLipLandmarker()
  openCamera?: (video: HTMLVideoElement) => Promise<CameraHandle>; // 기본: camera.ts의 openCamera
  now?: () => number;                                          // 기본: performance.now()
  /** 다음 프레임에 cb를 부른다. 취소 함수를 돌려준다. 기본: requestAnimationFrame. */
  scheduleFrame?: (cb: () => void) => () => void;
  pipeline?: Omit<PipelineOptions, "templates" | "manualSession">;
  onWarning?: (message: string) => void;                      // 기본: console.warn
}

export class LipRecognizer implements Recognizer {
  constructor(deps?: LipRecognizerDeps);
  start(video: HTMLVideoElement, onResult: (event: RecognitionEvent) => void, options?: RecognizerOptions): Promise<void>;
  stop(): void;
}
```

`start` 순서 (각 await 뒤에 그사이 `stop()`/새 `start()`가 불렸으면 — 세대 번호로 판단 — 만든 것을 정리하고 끝낸다):

1. 이전 실행이 있으면 `stop()`.
2. 템플릿을 먼저 읽는다. 없거나(null) 템플릿 있는 문장이 없으면 → 경고 "기기에 템플릿이 없습니다 — /dev/lips에서 만드세요" 후 끝 (카메라를 켜지 않는다).
3. 카메라를 켠다.
4. landmarker를 만든다.
5. `RecognitionPipeline({ templates, manualSession: options?.manualSession, ...deps.pipeline })`.
6. 프레임 루프: `scheduleFrame`으로 매 프레임 — `video.readyState >= 2`이고 `video.currentTime`이 지난번 처리 때보다 커졌을 때만
   `t = now()` → `landmarker.detect(video, t)` → `pipeline.push(landmarks, video.videoWidth, video.videoHeight, t)` → 이벤트면 `onResult(event)`.
   같은 프레임을 두 번 처리하지 않는다. (`requestVideoFrameCallback`은 숨긴 video에서 불리지 않을 수 있어 쓰지 않는다.)
- 어느 단계든 throw하면: 경고를 남기고 지금까지 만든 것(카메라·landmarker·루프)을 정리한 뒤 resolve한다 (reject하지 않는다).
- `onResult`가 throw해도 경고만 남기고 루프는 계속한다.

`stop()`: 세대 번호 증가 → 루프 취소 → `landmarker.close()` → 카메라 `stop()` → 파이프라인 `reset()`. 여러 번 불러도 된다. 실행 중이 아니어도 된다.

### 3. 테스트 `src/recognition/lipRecognizer.test.ts` (Node — 모든 브라우저 부분을 deps로 가짜로 바꾼다)

- 가짜 video: `{ readyState: 4, currentTime, videoWidth: 640, videoHeight: 480 }` (테스트가 currentTime을 올린다)
- 가짜 시계·스케줄러: `scheduleFrame`이 cb를 모아 두고 테스트가 한 프레임씩 부른다 (시계 +33ms, currentTime +0.033)
- 가짜 landmarker: 시계에 따라 합성 "단어" 얼굴 점(478개, 입술 자리 타원)을 돌려준다. 템플릿은 같은 합성 단어로 만든다(`analysis.segmentsFromFrames` + `buildTemplateSet`).
- 사례:
  - 템플릿 없음 → 경고 1회, `openCamera`·`createLandmarker` 안 불림, 이벤트 없음
  - 정상: 단어를 말하는 프레임을 흘리면 정지 500ms 뒤 `onResult` 1회, phraseId 정답, gate speak
  - `manualSession`이 파이프라인까지 전달됨 (점수 0.8~0.9 사례에서 show → speak)
  - 먼 움직임(`pipeline.score.rejectDistance`를 작게) → discard 이벤트도 `onResult`로 온다
  - 같은 currentTime이면 detect를 다시 부르지 않는다, readyState < 2면 건너뛴다
  - `stop()` → 카메라 stop·landmarker close·루프 취소, 이후 프레임에서 이벤트 없음, 두 번 불러도 에러 없음
  - 템플릿 읽는 중에 `stop()` → 카메라를 켜지 않음 / 카메라 켜는 중에 `stop()` → 켜진 카메라를 바로 끔
  - `start` 두 번 → 앞 실행 정리(카메라 stop 1회)
  - `openCamera`가 reject → `start`는 resolve, 경고, landmarker 안 만듦
  - `onResult`가 throw → 경고, 다음 단어도 인식

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
! grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" src/recognition --include=*.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/recognition/`)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가? (네트워크 없음, 프레임을 저장·전송하지 않음)
3. 결과에 따라 `phases/recognition/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 템플릿이 없을 때 가짜·임의 결과를 내보내지 마라. 이유: "말 안 했는데 나옴"은 사고다 (ADR 철학).
- 계약 `src/types/recognition.ts`, `src/recognition/mockRecognizer.ts`, 앞 step의 `src/recognition/*.ts`, `src/offline/**`, `src/app/**`를 수정하지 마라.
  이유: A와 합의한 계약·A의 구현이거나 이미 검수된 산출물이다. 화면 연결은 다음 step에서 한다.
- 카메라 프레임을 저장·전송하지 마라. 네트워크 호출을 하지 마라. 이유: CLAUDE.md CRITICAL.
- npm 의존성을 추가하지 마라.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
