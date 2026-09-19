# Step 4: mediapipe-landmarker

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. 카메라 입모양을 고정 문장 5개(`STARTER_PHRASE_IDS`) 중 하나로
분류해 A의 화면에 `RecognitionEvent`로 넘기는 `Recognizer`를 만든다. 파이프라인은
C1 입술 추출 → C2 구간 검출 → C3 정규화 → C4 인식(DTW) → C5 판정 게이트(`src/recognition/gate.ts`)다.

앞 step에서 순수 계산 모듈(`types.ts`, `normalize.ts`, `dtw.ts`, `lips.ts`, `segment.ts`)을 만들었다.
이 step은 C1의 브라우저 부분 — MediaPipe Face Landmarker(WASM)를 불러 비디오 프레임에서 얼굴 점 478개를 얻는 래퍼 — 와,
그 실행에 필요한 에셋(모델·WASM)을 **같은 출처(`public/`)에서** 제공하는 설정을 만든다. CDN을 쓰지 않는다(오프라인 원칙).

사용자가 새 의존성 `@mediapipe/tasks-vision` 추가를 승인했다 (CLAUDE.md 기술 스택에 명시된 C1 엔진, Apache-2.0).

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (컴포넌트 C1, 디렉토리 `public/`), `/CLAUDE.md` (CRITICAL: `src/recognition/` 네트워크 금지)
- `/src/recognition/types.ts` (`LIP_LANDMARK_INDICES`), `/src/recognition/lips.ts` (`LandmarkPoint`)
- `/package.json`, `/.gitignore`, `/vitest.config.ts`
- `/public/mediapipe/face_landmarker.task` — 이미 놓여 있는 모델 파일(Google 공식 float16 v1, 3,758,596바이트,
  sha256 `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`). 새로 받지 말고 이 파일을 쓴다.

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD — 브라우저 전용 부분은 제외, 아래 참고).

### 1. 의존성

```bash
npm install @mediapipe/tasks-vision@^1.0.1
```

- `package.json` `dependencies`에 들어간다. `package-lock.json`도 함께 갱신된다.
- 갱신 뒤 `npm ci`가 성공해야 한다 (lock과 package.json 동기화 확인 — 이전에 `@emnapi/*` 누락으로 `npm ci`가 실패한 적이 있다).

### 2. WASM 에셋 복사 — `scripts/copy-mediapipe-wasm.mjs` + `postinstall`

- `node_modules/@mediapipe/tasks-vision/wasm/`의 `vision_wasm_internal.js`, `vision_wasm_internal.wasm`,
  `vision_wasm_nosimd_internal.js`, `vision_wasm_nosimd_internal.wasm` 4개를 `public/mediapipe/wasm/`로 복사한다.
  (MediaPipe가 브라우저 SIMD 지원 여부에 따라 둘 중 하나를 고른다.)
- 대상 폴더가 없으면 만들고, 이미 있으면 덮어쓴다 (여러 번 돌려도 같은 결과). 원본이 없으면 이유를 출력하고 종료 코드 1.
- `package.json` `scripts`에 `"postinstall": "node scripts/copy-mediapipe-wasm.mjs"`를 추가한다 — `npm install`·`npm ci`·Vercel 빌드 때 자동 실행.
- `.gitignore`에 `public/mediapipe/wasm/`를 추가한다. WASM(약 22MB)은 커밋하지 않는다 — 설치할 때마다 패키지에서 복사한다.
- 모델 파일 `public/mediapipe/face_landmarker.task`는 커밋한다 (설치 때 네트워크 없이 쓸 수 있게).
- `public/mediapipe/NOTICE.txt`: 모델·WASM 출처(`@mediapipe/tasks-vision` 1.x, 모델 URL
  `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`),
  라이선스 Apache-2.0, 모델 sha256을 적는다.

### 3. `src/recognition/landmarker.ts` — MediaPipe 래퍼 (브라우저 전용)

```ts
import type { LandmarkPoint } from "./lips";

/** 같은 출처 정적 경로. CDN을 쓰지 않는다 — 오프라인 원칙(ADR-002). */
export const MEDIAPIPE_WASM_BASE = "/mediapipe/wasm";
export const FACE_LANDMARKER_MODEL_PATH = "/mediapipe/face_landmarker.task";

export interface LipLandmarkerOptions {
  wasmBase?: string;      // 기본 MEDIAPIPE_WASM_BASE
  modelPath?: string;     // 기본 FACE_LANDMARKER_MODEL_PATH
  delegate?: "CPU" | "GPU"; // 기본 "GPU" (실패 시 CPU로 한 번 재시도)
}

export interface LipLandmarker {
  /**
   * 비디오의 현재 프레임에서 첫 얼굴의 점(478개)을 돌려준다. 얼굴이 없으면 null.
   * timestampMs는 호출마다 엄격히 증가해야 한다(MediaPipe VIDEO 모드 조건) — 아니면 null을 돌려주고 추론하지 않는다.
   */
  detect(video: HTMLVideoElement, timestampMs: number): LandmarkPoint[] | null;
  close(): void;
}

export async function createLipLandmarker(options?: LipLandmarkerOptions): Promise<LipLandmarker>;
```

- `@mediapipe/tasks-vision`은 `createLipLandmarker` 안에서 **동적 import**한다 (서버 렌더링·다른 화면 번들에 끼지 않게).
- `FilesetResolver.forVisionTasks(wasmBase)` → `FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false })`.
- GPU 생성이 throw하면 CPU로 한 번 다시 만든다.
- `detect`는 결과의 `faceLandmarks[0]`을 `{x, y}` 배열로 복사해 돌려준다 (MediaPipe 결과 객체를 붙잡지 않는다). 비디오가 아직 프레임이 없으면(`readyState < 2`) null.
- 파일 머리 주석에: 이 모듈은 앱 시작 때 **같은 출처 정적 에셋**(모델·WASM)을 MediaPipe가 불러온다는 것, 발화 경로(프레임 처리) 중에는 네트워크를 쓰지 않는다는 것, 오프라인 캐시는 PWA 서비스워커 몫이라는 것을 적는다.
- 이 파일은 WASM·비디오가 필요해 Node 단위 테스트를 하지 않는다 (다음 step의 개발용 수집 페이지에서 실제로 확인한다).

### 4. 테스트 `src/recognition/landmarker.test.ts` (Node에서 가능한 것만)

- `LIP_LANDMARK_INDICES`를 정렬한 것 = `FaceLandmarker.FACE_LANDMARKS_LIPS`의 `start`·`end` 고유 점을 정렬한 것 (40개) —
  `@mediapipe/tasks-vision`을 테스트에서 정적으로 import해도 Node에서 동작한다.
- 경로 상수가 `/`로 시작하고 `http`를 포함하지 않는다 (CDN 금지).
- `public/mediapipe/face_landmarker.task`가 존재하고 크기가 3,758,596바이트다 (`node:fs`).

## Acceptance Criteria

```bash
npm ci
test -f public/mediapipe/wasm/vision_wasm_internal.js && test -f public/mediapipe/wasm/vision_wasm_internal.wasm && test -f public/mediapipe/wasm/vision_wasm_nosimd_internal.js && test -f public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm
git check-ignore -q public/mediapipe/wasm/vision_wasm_internal.wasm
sha256sum public/mediapipe/face_landmarker.task | grep -q 64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff
npm run lint && npm run build && npm run test
! grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" src/recognition --include=*.ts
! grep -rnE "cdn\.jsdelivr|unpkg\.com|storage\.googleapis" src --include=*.ts --include=*.tsx
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/recognition/`, `public/`, `scripts/`)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/recognition/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `@mediapipe/tasks-vision` 외 의존성을 추가하지 마라. 이유: 승인받은 것은 이것 하나다.
- WASM 파일(`public/mediapipe/wasm/`)을 커밋하지 마라. 이유: 약 22MB이고 설치 때 패키지에서 복사된다.
- 모델·WASM을 CDN·외부 URL에서 불러오지 마라. 이유: 오프라인 원칙(ADR-002) — 같은 출처 정적 경로만 쓴다.
- 모델 파일을 새로 내려받거나 바꾸지 마라. 이유: 이미 검증된 파일(sha256 고정)이 놓여 있다.
- `src/types/recognition.ts`, `src/lib/phrases.ts`, `src/recognition/gate.ts`, `src/recognition/mockRecognizer.ts`, 앞 step의 `src/recognition/*.ts`, `src/app/**`를 수정하지 마라.
  이유: A와 합의한 계약·A의 구현이거나 이미 검수·병합된 산출물이다.
- `package.json`에서 `postinstall` 추가와 의존성 추가 외의 항목을 바꾸지 마라. 이유: 다른 담당의 스크립트·설정이다.
- 실제 녹화 영상·입술 좌표 파일을 레포에 추가하지 마라. 이유: 생체정보 성격의 학습 데이터이고 GitHub는 국외 서버다.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
