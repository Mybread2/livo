# Step 0: lip-normalize

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. 카메라 입모양을 고정 문장 5개(`STARTER_PHRASE_IDS`) 중 하나로
분류해 A의 화면에 `RecognitionEvent`로 넘기는 `Recognizer`를 만든다. 파이프라인은
C1 입술 추출 → C2 구간 검출 → C3 정규화 → C4 인식(DTW) → C5 판정 게이트(이미 `src/recognition/gate.ts`에 있다)다.

이 step은 B 내부 공용 타입과 C3 정규화를 만든다. 순수 함수라 브라우저·카메라·MediaPipe 없이 합성 좌표로 테스트한다.

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (컴포넌트 표의 C1~C5)
- `/docs/ADR.md` (ADR-004)
- `/src/types/recognition.ts` (A ↔ B 계약 — 읽기만)
- `/src/recognition/gate.ts`, `/src/recognition/gate.test.ts` (이 폴더의 코드·테스트 스타일)
- `/vitest.config.ts`, `/tsconfig.json`

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/recognition/types.ts` — B 내부 타입·상수. 아래를 **그대로** 옮긴다 (주석 포함)

```ts
// B 내부 타입. A ↔ B 계약(src/types/recognition.ts)과 별개로, 인식 파이프라인 단계 사이에서만 쓴다.

/** C1이 뽑는 입술 점 = MediaPipe Face Landmarker 478점 중 입술 40점. 이 순서가 곧 좌표 배열 순서다. */
export const LIP_LANDMARK_INDICES = [
  // 바깥 입술: 입꼬리 61 → 윗입술 → 입꼬리 291 → 아랫입술 → 61 직전까지
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
  // 안쪽 입술: 78 → 윗입술 안쪽 → 308 → 아랫입술 안쪽 → 78 직전까지
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
] as const;

export const LIP_POINT_COUNT = LIP_LANDMARK_INDICES.length; // 40
export const FEATURE_DIM = LIP_POINT_COUNT * 2; // 80 = 40점 × (x, y)
export const SEQ_FRAMES = 32; // C3가 모든 구간을 맞추는 프레임 수

/** 바깥 입꼬리 두 점의 위치(LIP_LANDMARK_INDICES 안의 순번). C3가 기울기·크기 기준으로 쓴다. */
export const CORNER_A = 0; // landmark 61
export const CORNER_B = 10; // landmark 291

/** C1 출력 한 프레임. */
export interface LipFrame {
  /** 타임스탬프(ms). 한 구간 안에서 증가한다. */
  t: number;
  /** [x0, y0, x1, y1, …] 길이 FEATURE_DIM. 가로·세로 비율을 맞춘 좌표(정규화 x에 영상 가로/세로 비를 곱한 값). */
  points: Float32Array;
}

/** C3 출력. SEQ_FRAMES개 행 × FEATURE_DIM열. */
export type Sequence = Float32Array[];
```

### 2. `src/recognition/normalize.ts` — C3 정규화

```ts
export function normalizeSegment(frames: readonly LipFrame[]): Sequence | null;
```

처리 순서 (순서가 계약이다):

1. 프레임마다 40점의 평균(중심)을 빼 원점으로 옮긴다 — 얼굴 위치 이동 제거.
2. 프레임마다 `CORNER_A → CORNER_B` 방향이 +x축과 나란하도록 회전한다 — 고개 기울기 제거.
3. 구간 전체 입꼬리 거리(`CORNER_A`–`CORNER_B`)의 **중앙값**으로 모든 좌표를 나눈다 — 카메라 거리(얼굴 크기) 제거.
   프레임마다 따로 나누지 마라. 입을 옆으로 벌리거나 오므리는 변화 자체가 단어 정보라서 프레임별로 나누면 사라진다.
4. 시간 축을 `SEQ_FRAMES`개로 선형 보간 리샘플한다. 목표 시각은 첫 프레임 `t`부터 마지막 프레임 `t`까지
   균등 간격(양 끝 포함)이다. 입력 간격이 균일하지 않아도 `t` 기준으로 보간한다.

`null`을 반환하는 경우 (애매하면 안 나오는 쪽 — 호출자가 discard한다):

- 프레임이 2개 미만
- `t`가 엄격히 증가하지 않음 (첫·마지막 `t`가 같은 경우 포함)
- 어떤 프레임의 `points` 길이가 `FEATURE_DIM`이 아님
- 좌표에 `NaN`·`Infinity`가 있음
- 입꼬리 거리 중앙값이 `1e-6` 이하

### 3. 테스트 `src/recognition/normalize.test.ts`

합성 좌표만 쓴다. 테스트 파일 안에 "입 모양 생성 도우미"(예: 타원 위 40점, 시간에 따라 세로·가로 반지름이 변함)를 만든다.

- 출력 형태: `SEQ_FRAMES`개 행, 각 행이 길이 `FEATURE_DIM`인 `Float32Array`
- 이동 불변: 모든 점을 (dx, dy)만큼 옮겨도 결과 차이 < 1e-4
- 크기 불변: 모든 좌표에 k(0.5, 3)를 곱해도 결과 차이 < 1e-4
- 회전 불변: 임의 점 기준으로 ±20° 회전해도 결과 차이 < 1e-4
- 프레임률 불변: 같은 움직임을 15fps와 30fps로 샘플링하면 결과 차이 < 1e-2 (허용오차 근거를 주석으로)
- 비균일 간격: `t` 간격이 들쭉날쭉해도, 시간에 선형으로 변하는 좌표는 정확히 보간된다 (< 1e-5)
- 모양 보존: 세로로 벌리는 움직임과 가로로 늘리는 움직임은 결과가 다르고, 가로로 늘린 비율이 결과에 남는다
- `null` 조건 5가지 각각

## Acceptance Criteria

```bash
npm run lint && npm run build && npm run test
! grep -rnE "fetch\(|XMLHttpRequest|WebSocket|sendBeacon" src/recognition --include=*.ts
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

- `src/types/recognition.ts`, `src/lib/phrases.ts`, `src/recognition/gate.ts`, `src/recognition/mockRecognizer.ts`를 수정하지 마라.
  이유: A와 합의한 계약·A의 구현이다. 변경은 셋의 동의로만 한다.
- `src/recognition/`에서 fetch·XMLHttpRequest·WebSocket 등 네트워크 호출을 하지 마라.
  이유: CLAUDE.md CRITICAL — 고정 문장 경로는 단말에서 네트워크 없이 끝난다.
- npm 의존성을 추가하지 마라. 이유: 새 의존성은 사용자 승인 대상이고, 이 step은 순수 TypeScript로 충분하다.
- 실제 녹화 영상·입술 좌표 파일을 레포에 추가하지 마라(테스트 픽스처 포함).
  이유: 생체정보 성격의 학습 데이터이고 GitHub는 국외 서버다 (CLAUDE.md: 수집 학습 데이터 국외 반출 금지).
- MediaPipe·카메라·DOM에 의존하는 코드를 만들지 마라. 이유: 이 step은 Node 환경(vitest `environment: node`) 순수 함수다. C1은 뒤 step에서 만든다.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
