# Step 2: lip-points

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. 카메라 입모양을 고정 문장 5개(`STARTER_PHRASE_IDS`) 중 하나로
분류해 A의 화면에 `RecognitionEvent`로 넘기는 `Recognizer`를 만든다. 파이프라인은
C1 입술 추출 → C2 구간 검출 → C3 정규화 → C4 인식(DTW) → C5 판정 게이트(`src/recognition/gate.ts`)다.

step 0에서 B 내부 타입(`types.ts` — 입술 40점 번호 `LIP_LANDMARK_INDICES`, `LipFrame`)과 C3 정규화를,
step 1에서 C4 DTW 거리를 만들었다. 이 step은 C1의 순수 계산 부분이다:
MediaPipe Face Landmarker가 한 프레임에 내는 얼굴 점 478개(정규화 좌표)에서 입술 40점만 골라 `LipFrame`으로 만든다.
MediaPipe 호출 자체(브라우저·WASM)는 뒤 step에서 만든다 — 이 step은 MediaPipe 없이 가짜 점 배열로 테스트한다.

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (컴포넌트 표 C1)
- `/src/recognition/types.ts` (특히 `LIP_LANDMARK_INDICES`, `LipFrame.points` 좌표 규약 주석)
- `/src/recognition/normalize.ts`, `/src/recognition/normalize.test.ts`, `/src/recognition/dtw.ts` (스타일·테스트 방식)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/recognition/lips.ts` — C1 입술 40점 선택

```ts
import type { LipFrame } from "./types";

/** MediaPipe NormalizedLandmark와 같은 모양(구조 타입). x·y는 영상 가로·세로에 대한 0~1 비율. */
export interface LandmarkPoint {
  x: number;
  y: number;
}

/**
 * 얼굴 점 배열에서 입술 40점을 LIP_LANDMARK_INDICES 순서대로 골라 LipFrame으로 만든다.
 * 좌표 규약(types.ts): x는 정규화 x에 (width / height)를 곱하고, y는 정규화 y 그대로 — 가로·세로 1단위 길이를 같게 한다.
 * 쓸 수 없는 입력이면 null (호출자는 그 프레임을 건너뛴다).
 */
export function extractLipFrame(
  landmarks: ArrayLike<LandmarkPoint>,
  width: number,
  height: number,
  t: number,
): LipFrame | null;
```

`null`을 반환하는 경우:

- `landmarks.length`가 `LIP_LANDMARK_INDICES`의 가장 큰 번호 이하 (그 점이 없음)
- `width`·`height`가 양의 유한수가 아님
- `t`가 유한수가 아님
- 고른 40점 중 x·y에 `NaN`·`Infinity`가 있음

그 밖:

- 출력 `points`는 새 `Float32Array(FEATURE_DIM)` — 입력 배열을 붙잡아 두지 않는다 (MediaPipe는 결과 객체를 재사용할 수 있다).
- `@mediapipe/*`를 import하지 마라. 구조 타입(`LandmarkPoint`)만 쓴다.

### 2. 테스트 `src/recognition/lips.test.ts`

가짜 얼굴 점 배열을 만든다 (예: 478개, 점 k의 x = k/1000, y = k/2000).

- 40점이 `LIP_LANDMARK_INDICES` 순서대로 들어간다 (순번 p의 x = 번호/1000 × 가로세로비, y = 번호/2000)
- 가로세로비: 1280×720이면 x에 16/9를 곱하고 y는 그대로
- 입력이 가로·세로로 같은 실제 길이만큼 움직인 두 점은 출력에서도 같은 길이다 (예: 정사각형이 아닌 영상에서 원 → 원)
- `t`가 그대로 들어간다
- 출력이 입력과 독립: 추출 뒤 입력 점을 바꿔도 출력은 그대로
- `null` 조건 4가지 각각 (468개 얼굴 메시도 가장 큰 번호 415보다 길므로 정상 처리됨을 함께 확인)

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
! grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" src/recognition --include=*.ts
! grep -rn "@mediapipe" src/recognition --include=*.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉토리 구조를 따르는가? (`src/recognition/`)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/recognition/index.json`의 해당 step을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `@mediapipe/tasks-vision` 등 npm 의존성을 추가하거나 import하지 마라. 이유: 새 의존성은 사용자 승인 대상이고(뒤 step에서 승인 후 추가), 이 step은 순수 계산이다.
- `src/types/recognition.ts`, `src/lib/phrases.ts`, `src/recognition/gate.ts`, `src/recognition/mockRecognizer.ts`, `src/recognition/types.ts`, `src/recognition/normalize.ts`, `src/recognition/dtw.ts`를 수정하지 마라.
  이유: A와 합의한 계약·A의 구현이거나 이미 검수·병합된 산출물이다.
- `src/recognition/`에서 fetch·XMLHttpRequest·WebSocket 등 네트워크 호출을 하지 마라.
  이유: CLAUDE.md CRITICAL — 고정 문장 경로는 단말에서 네트워크 없이 끝난다.
- 실제 녹화 영상·입술 좌표 파일을 레포에 추가하지 마라(테스트 픽스처 포함).
  이유: 생체정보 성격의 학습 데이터이고 GitHub는 국외 서버다 (CLAUDE.md: 수집 학습 데이터 국외 반출 금지).
- 카메라·DOM에 의존하는 코드를 만들지 마라. 이유: 이 step은 Node 환경(vitest `environment: node`) 순수 함수다.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
