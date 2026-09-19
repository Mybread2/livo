# Step 1: dtw-nearest

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. 카메라 입모양을 고정 문장 5개(`STARTER_PHRASE_IDS`) 중 하나로
분류해 A의 화면에 `RecognitionEvent`로 넘기는 `Recognizer`를 만든다. 파이프라인은
C1 입술 추출 → C2 구간 검출 → C3 정규화 → C4 인식(DTW) → C5 판정 게이트(`src/recognition/gate.ts`)다.

step 0에서 B 내부 타입(`src/recognition/types.ts`)과 C3 정규화(`normalizeSegment`, 출력 `Sequence` = 32행 × 80열)를 만들었다.
이 step은 C4의 거리 계산 부분이다: 두 `Sequence` 사이의 DTW 거리와, 문장별 템플릿 중 가장 가까운 문장 찾기.
거리를 0~1 점수로 바꾸는 식과 거절 기준은 실제 녹화 데이터를 본 뒤 뒤 step에서 정한다 — 이 step에서 만들지 않는다.

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (컴포넌트 표 C4, 판정 게이트 C5)
- `/docs/ADR.md` (ADR-004 DTW vs 소형 CNN, ADR-005 게이트)
- `/src/recognition/types.ts`, `/src/recognition/normalize.ts`, `/src/recognition/normalize.test.ts` (step 0 산출물 — 스타일·테스트 방식을 맞춘다)
- `/src/recognition/gate.ts` (C5 입력: `score`, `rejected` — 이 step은 여기에 넘길 값을 만들기 위한 재료다)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/recognition/dtw.ts` — C4 거리 계산

```ts
import type { Sequence } from "./types";

/** 문장 id → 그 문장의 템플릿(정규화된 Sequence)들. 키 순서가 동점 처리 순서다. */
export type TemplateSet = Readonly<Record<string, readonly Sequence[]>>;

export interface DtwOptions {
  /** Sakoe-Chiba 폭(프레임 수). 경로가 대각선에서 이만큼까지만 벗어날 수 있다. 기본 DEFAULT_BAND. */
  band?: number;
}

/** 기본 폭 = SEQ_FRAMES의 25% (32프레임이면 8). */
export const DEFAULT_BAND: number;

/** 두 프레임(길이 같은 Float32Array) 사이 유클리드 거리. */
export function frameDistance(a: Float32Array, b: Float32Array): number;

/** 두 Sequence 사이 DTW 거리. 누적 비용을 (a.length + b.length)로 나눈 값. */
export function dtwDistance(a: Sequence, b: Sequence, options?: DtwOptions): number;

export interface NearestResult {
  /** 가장 가까운 문장 id. */
  label: string;
  /** 그 문장까지 거리 = 그 문장 템플릿들 중 최소 DTW 거리. */
  d1: number;
  /** 두 번째로 가까운 "다른" 문장까지 거리. 템플릿이 있는 문장이 하나뿐이면 Infinity. */
  d2: number;
  /** 템플릿이 있는 문장별 최소 거리 (뒤 step의 점수 설계·분석용). */
  distances: Record<string, number>;
}

/** 템플릿이 있는 문장이 하나도 없으면 null. */
export function nearestPhrases(query: Sequence, templates: TemplateSet, options?: DtwOptions): NearestResult | null;
```

규칙:

- 누적 비용 `D[i][j] = frameDistance(a[i], b[j]) + min(D[i-1][j], D[i][j-1], D[i-1][j-1])`, 시작 `D[0][0] = frameDistance(a[0], b[0])`,
  끝 `D[n-1][m-1]`. 결과는 `D[n-1][m-1] / (n + m)`.
- 폭 제한: `|i - j| > band`인 칸은 지나갈 수 없다. 길이가 다른 두 시퀀스도 끝에 도달할 수 있도록 실제 폭은 `max(band, |n - m|)`.
  `band`가 음수·NaN이면 throw.
- `dtwDistance`는 빈 시퀀스, 행 길이가 서로 다르거나 `FEATURE_DIM`이 아닌 행이 있으면 throw한다 (C3가 보장하는 모양이 깨진 것은 프로그래밍 오류다).
- 메모리는 두 행(이전·현재)만 쓴다 — 32×32 전체 표를 만들 필요 없다.
- `nearestPhrases`: 문장별 거리는 그 문장 템플릿들 중 **최소** 거리(1-NN). 템플릿 배열이 비어 있는 문장은 무시한다.
  거리가 같으면 `templates`의 키 순서에서 먼저 나온 문장을 고른다 (결과가 실행마다 바뀌지 않게).

### 2. 테스트 `src/recognition/dtw.test.ts`

합성 `Sequence`만 쓴다 (step 0처럼 테스트 파일 안에 생성 도우미를 만든다. 실제 녹화 데이터 금지).
"말 모양"은 예: 프레임 진행도 s에 대해 각 열이 서로 다른 위상의 sin 곡선인 32×80 시퀀스.

- 같은 시퀀스끼리 거리는 0
- 대칭: `dtwDistance(a, b) === dtwDistance(b, a)` (부동소수 오차 < 1e-9)
- 0 이상이고 유한하다
- 시간 왜곡 허용: 같은 모양을 앞은 빠르게·뒤는 느리게 진행한 시퀀스는, 프레임을 순서대로 짝지은(대각선) 거리보다 DTW 거리가 확실히 작다
- 모양 구분: 시간만 왜곡한 같은 모양까지의 거리 < 다른 모양까지의 거리
- `band: 0`이면 대각선 경로만 가능 — 결과 = `Σ frameDistance(a[i], b[i]) / (2n)`
- 길이가 다른 두 시퀀스(예: 32행과 20행)도 `band`가 작아도 유한한 거리가 나온다
- throw: 빈 시퀀스, 행 길이 불일치, `band` 음수
- `nearestPhrases`:
  - 서로 다른 3개 "말 모양" 템플릿 중, B 모양을 시간 왜곡한 질의 → `label`이 B
  - `d1 <= d2`, `distances`에 템플릿 있는 모든 문장이 들어 있다
  - 문장 하나에 템플릿 여러 개면 그중 최소 거리가 쓰인다
  - 템플릿 있는 문장이 하나뿐이면 `d2 === Infinity`
  - 템플릿이 비어 있는 문장은 무시, 전부 비어 있거나 `{}`이면 `null`
  - 동점이면 키 순서가 앞선 문장

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

- 거리 → 점수(0~1) 변환이나 거절 기준값을 만들지 마라. 이유: 실제 녹화 데이터의 거리 분포를 보고 사용자와 정하기로 했다 (뒤 step).
- `src/types/recognition.ts`, `src/lib/phrases.ts`, `src/recognition/gate.ts`, `src/recognition/mockRecognizer.ts`, `src/recognition/types.ts`, `src/recognition/normalize.ts`를 수정하지 마라.
  이유: A와 합의한 계약·A의 구현이거나 이미 검수·병합된 step 0 산출물이다.
- `src/recognition/`에서 fetch·XMLHttpRequest·WebSocket 등 네트워크 호출을 하지 마라.
  이유: CLAUDE.md CRITICAL — 고정 문장 경로는 단말에서 네트워크 없이 끝난다.
- npm 의존성을 추가하지 마라. 이유: 새 의존성은 사용자 승인 대상이고, 이 step은 순수 TypeScript로 충분하다.
- 실제 녹화 영상·입술 좌표 파일을 레포에 추가하지 마라(테스트 픽스처 포함).
  이유: 생체정보 성격의 학습 데이터이고 GitHub는 국외 서버다 (CLAUDE.md: 수집 학습 데이터 국외 반출 금지).
- MediaPipe·카메라·DOM에 의존하는 코드를 만들지 마라. 이유: 이 step은 Node 환경(vitest `environment: node`) 순수 함수다.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
