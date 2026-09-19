# Step 7: recognition-pipeline

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. 지금까지 순수 모듈을 하나씩 만들었다:
`lips.ts`(C1 입술 40점 → `LipFrame`) · `segment.ts`(C2 구간 검출) · `normalize.ts`(C3) · `dtw.ts`(C4 거리·최근접) ·
`score.ts`(거리 → 점수·거절) · A의 `gate.ts`(C5 `decideGate`).
이 step은 이것들을 **한 줄로 잇는 순수 파이프라인**과, 개발용 수집 페이지·분석에 쓸 순수 도우미를 만든다.
브라우저·카메라·MediaPipe 없이 가짜 얼굴 점으로 끝까지 테스트할 수 있어야 한다 (다음 step의 `Recognizer`는 이 파이프라인에 프레임만 흘려 넣는다).

A ↔ B 계약(`src/types/recognition.ts`): 결과는 `RecognitionEvent {phraseId, text, score, gate}`이고 **discard도 콜백으로 보낸다**.

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/src/types/recognition.ts` (A ↔ B 계약 — 읽기만), `/src/lib/phrases.ts` (`getPhrase`, `isPhraseId`)
- `/src/recognition/types.ts`, `lips.ts`, `segment.ts`, `normalize.ts`, `dtw.ts`, `score.ts`, `gate.ts` 와 각 테스트 (합성 입 모양 테스트 방식)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/recognition/pipeline.ts`

```ts
import type { RecognitionEvent } from "@/types/recognition";
import type { LandmarkPoint } from "./lips";
import type { SegmentOptions } from "./segment";
import type { DtwOptions, TemplateSet } from "./dtw";
import type { ScoreParams } from "./score";

export interface PipelineOptions {
  templates: TemplateSet;
  manualSession?: boolean;          // true면 게이트 speak 문턱 0.80
  segment?: SegmentOptions;
  dtw?: DtwOptions;
  score?: Partial<ScoreParams>;
}

export class RecognitionPipeline {
  constructor(options: PipelineOptions);
  /**
   * 한 프레임을 넣는다. 발화 구간이 끝나 판정이 나온 프레임이면 RecognitionEvent(discard 포함), 아니면 null.
   * landmarks가 null(얼굴 없음)이면 진행 중 구간을 버린다(C2 reset) — 얼굴을 놓친 사이의 움직임은 믿을 수 없다.
   */
  push(landmarks: ArrayLike<LandmarkPoint> | null, width: number, height: number, t: number): RecognitionEvent | null;
  reset(): void;
}
```

흐름: `extractLipFrame` → (null이면 null 반환) → `SegmentDetector.push` → 구간이 끝났으면 `normalizeSegment`
→ (null이면 null) → `nearestPhrases` → (null이면 null) → `scoreNearest` → `decideGate({score, rejected, manualSession})`
→ `{ phraseId: label, text: getPhrase(label).text, score, gate }`.

- `label`이 등록 문장이 아니면(`isPhraseId` false) 이벤트를 만들지 않는다(null) — 화면에 모르는 텍스트를 띄우지 않는다.
- 템플릿이 없는 문장은 후보가 아니다 (`nearestPhrases` 규칙 그대로).

### 2. `src/recognition/analysis.ts` — 개발·보정용 순수 도우미

```ts
import type { LipFrame, Sequence } from "./types";
import type { SegmentOptions } from "./segment";
import type { TemplateSet } from "./dtw";

/** 프레임 스트림에서 구간을 모두 잘라 정규화까지 한 것. */
export function segmentsFromFrames(frames: readonly LipFrame[], options?: SegmentOptions): { frames: LipFrame[]; seq: Sequence }[];

export interface LabeledSequence { phraseId: string; seq: Sequence }

/** 문장별로 모아 TemplateSet으로 (입력 순서 유지). */
export function buildTemplateSet(samples: readonly LabeledSequence[]): TemplateSet;

export interface LooRow { index: number; phraseId: string; predicted: string | null; d1: number; d2: number; score: number; rejected: boolean }

/** 하나씩 빼고 맞히기 — 나머지로 템플릿을 만들어 각 표본을 분류한다 (scoreNearest 포함). */
export function leaveOneOut(samples: readonly LabeledSequence[]): LooRow[];
```

### 3. 테스트 `src/recognition/pipeline.test.ts`, `src/recognition/analysis.test.ts`

합성 얼굴 점만 쓴다 (478개 배열 중 `LIP_LANDMARK_INDICES` 자리에 타원 입 모양, 나머지 0.5).
서로 다른 합성 "단어" 3개 이상(예: 크게 한 번 벌림 / 옆으로 늘리며 두 번 벌림 / 오므리며 늦게 벌림)을 등록 문장 id(`pain`·`water`·`toilet` 등)에 붙인다.

- 템플릿과 같은 단어를 다른 속도·프레임률(15·24·30fps)·얼굴 위치로 말하면 → 이벤트 1개, `phraseId` 정답, `text`는 phrases의 문장
- 이벤트는 발화가 끝난 뒤(정지 500ms) 한 번만 나온다, 쉬기만 하면 이벤트 없음
- 게이트: 템플릿과 똑같은 움직임 → speak, `manualSession`이 게이트에 전달된다(점수 0.8~0.9 사례에서 speak/show가 갈림)
- 거절: 어느 템플릿과도 먼 움직임(`score.rejectDistance`를 작게 줘서 재현) → gate discard 이벤트
- 얼굴 없음(null) 프레임이 발화 중에 끼면 그 구간은 버려지고, 이후 새 발화는 정상 인식
- 템플릿이 비어 있으면(`{}`) 이벤트 없음 · 등록되지 않은 id(예: `"zzz"`)로만 된 템플릿이면 이벤트 없음
- `analysis`: `segmentsFromFrames`가 두 단어 스트림에서 2구간, `buildTemplateSet` 문장별 묶음, `leaveOneOut`이 합성 3단어 × 3회에서 모두 정답·rejected false

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

- 앞 step의 `src/recognition/*.ts`, `src/types/**`, `src/lib/phrases.ts`, `src/offline/**`, `src/app/**`를 수정하지 마라.
  이유: A와 합의한 계약·다른 담당 구현이거나 이미 검수된 산출물이다. 필요한 것은 조합으로 해결한다.
- 브라우저·카메라·MediaPipe·IndexedDB에 의존하지 마라. 이유: 이 step은 Node 환경 순수 로직이다.
- 실제 녹화 영상·입술 좌표 파일을 레포에 추가하지 마라. 이유: 생체정보 성격의 학습 데이터이고 GitHub는 국외 서버다.
- npm 의존성을 추가하지 마라. 네트워크 호출을 하지 마라.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
