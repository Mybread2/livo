# Step 6: distance-score

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. C4 인식은 DTW 템플릿 매칭(`src/recognition/dtw.ts`의 `nearestPhrases` →
`{label, d1, d2, distances}`)이고, C5 판정 게이트(`src/recognition/gate.ts`의 `decideGate`)는 **0~1 점수**와 거절 여부를 받는다
(score < 0.70 버림 · 0.70~0.90 글자만 · ≥ 0.90 발화, 수동 세션 0.80). 이 step은 거리 → 점수·거절 변환을 만든다.

변환식은 실제 녹화 데이터(대상자 본인 무성 발화 5단어 × 3회, 로컬에서만 분석 — 레포에 두지 않음)로 정했다:

- 같은 단어끼리 DTW 거리: 중앙값 0.086 · 최대 0.185 / 다른 단어끼리: 최소 0.076 · 중앙값 0.167
- 하나씩 빼고 맞히기(단어당 템플릿 2개): 15개 중 13개 정답. 틀린 2개는 1·2위 거리 비율 d1/d2가 0.876·0.962,
  맞은 것은 0.371~0.696(11개)과 0.864·0.944(2개)
- 결정: 점수 = clamp(1.5 − d1/d2, 0, 1) → d1/d2 ≤ 0.6이면 발화(≥ 0.9), 0.6~0.8이면 글자만, > 0.8이면 버림.
  이 데이터에서 틀린 결과가 화면·소리로 나간 것 0건 (애매하면 안 나오는 쪽 — ADR-005).
- 절대 거리 거절: d1 > 0.20이면 NONE(어느 단어와도 멀다)으로 거절 — 같은 단어끼리 최대 거리 0.185 위.
  (비발화 움직임 녹화로 뒤에 보정할 출발값이다.)

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (판정 게이트 C5), `/docs/ADR.md` (ADR-004, ADR-005)
- `/src/recognition/dtw.ts` (`NearestResult`), `/src/recognition/gate.ts` (`GateInput`: `score`, `rejected`)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/recognition/score.ts`

```ts
import type { NearestResult } from "./dtw";

export interface ScoreParams {
  /** d1이 이보다 크면 거절(NONE). 기본 0.2 */
  rejectDistance: number;
  /** 점수 = clamp(ratioOffset − d1/d2, 0, 1). 기본 1.5 */
  ratioOffset: number;
}

/** 출발값 — 실제 녹화(5단어 × 3회) 분석으로 정했다. 비발화 녹화로 거절 거리를 보정한다. */
export const DEFAULT_SCORE_PARAMS: Readonly<ScoreParams>;

export interface ScoredResult {
  label: string;
  score: number;     // 0~1
  rejected: boolean; // true면 게이트가 discard
}

export function scoreNearest(result: NearestResult, params?: Partial<ScoreParams>): ScoredResult;
```

규칙 (위에서부터 먼저 맞는 것):

1. `d1`이 유한수가 아니거나 `d1 > rejectDistance` → `rejected: true`, `score: 0`.
2. `d2`가 유한수가 아님(템플릿 있는 문장이 하나뿐 — 비교 대상이 없어 확신도를 잴 수 없음) → `rejected: true`, `score: 0`.
3. `d2 <= 0` (d1 = d2 = 0 — 두 문장이 똑같이 가까움) → `rejected: false`, `score: 0`.
4. 그 밖 → `rejected: false`, `score = clamp(ratioOffset − d1 / d2, 0, 1)`.

- `label`은 `result.label` 그대로.
- `params`에 준 값만 기본값을 덮는다. `rejectDistance`·`ratioOffset`이 유한수가 아니거나 `rejectDistance < 0`이면 throw(RangeError).

### 2. 테스트 `src/recognition/score.test.ts`

- 기본값: `rejectDistance` 0.2, `ratioOffset` 1.5
- 경계: d1/d2 = 0.6 → 0.9(발화 문턱), 0.8 → 0.7(표시 문턱), 0.5 → 1.0(상한), 1.0 → 0.5
- `decideGate`와 이어 붙인 결과: d1/d2 0.4 → speak, 0.7 → show, 0.9 → discard, 수동 세션에서 0.65 → speak
- 위 배경의 실제 분석 수치를 고정 사례로: (d1 0.0757, d2 0.0864) → discard, (d1 0.1046, d2 0.1087) → discard,
  (d1 0.0334, d2 0.0757) → speak, (d1 0.0987, d2 0.1419) → show
- 거절: d1 0.21 → rejected, d1 Infinity·NaN → rejected, d2 Infinity → rejected
- d1 = d2 = 0 → score 0, rejected false
- params 부분 덮기, 잘못된 params → throw

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

- 게이트 임계값(`gate.ts`)을 바꾸지 마라. 이유: A가 구현한 C5이고 기획서·지시서에 고정된 값이다. 점수 쪽을 맞춘다.
- 기본값을 테스트를 통과시키려고 바꾸지 마라. 이유: 실제 데이터 분석으로 정한 값이다.
- `src/types/**`, `src/lib/phrases.ts`, `src/recognition/gate.ts`, `src/recognition/mockRecognizer.ts`, 앞 step의 `src/recognition/*.ts`, `src/offline/**`, `src/app/**`를 수정하지 마라.
  이유: A와 합의한 계약·다른 담당 구현이거나 이미 검수된 산출물이다.
- 실제 녹화 영상·입술 좌표·거리 원자료를 레포에 추가하지 마라. 위 요약 수치만 테스트 사례로 쓴다. 이유: 생체정보 성격 데이터이고 GitHub는 국외 서버다.
- npm 의존성을 추가하지 마라. 네트워크 호출을 하지 마라.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
