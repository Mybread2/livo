# Step 3: segment-detector

## 배경

이 phase는 B 담당(입모양 → 텍스트) 작업이다. 카메라 입모양을 고정 문장 5개(`STARTER_PHRASE_IDS`) 중 하나로
분류해 A의 화면에 `RecognitionEvent`로 넘기는 `Recognizer`를 만든다. 파이프라인은
C1 입술 추출 → C2 구간 검출 → C3 정규화 → C4 인식(DTW) → C5 판정 게이트(`src/recognition/gate.ts`)다.

앞 step에서 B 내부 타입(`types.ts`), C3 정규화(`normalize.ts`), C4 DTW 거리(`dtw.ts`), C1 입술 40점 선택(`lips.ts`)을 만들었다.
이 step은 C2 구간 검출이다: 프레임마다 들어오는 `LipFrame` 스트림에서 "말한 구간"(움직임 시작 ~ 0.5초 정지)을 잘라
C3에 넘길 `LipFrame[]`를 내보낸다. 기준 신호는 입 개폐량 시계열이다 (ARCHITECTURE.md C2).

안전 원칙: "말 안 했는데 나옴"은 사고, "말했는데 안 나옴"은 다시 말하면 된다. 애매한 구간(너무 짧음·너무 김·프레임 끊김)은 내보내지 않는다.
기준값들은 실제 녹화 데이터로 뒤 step에서 보정할 **출발값**이다 — 모두 옵션으로 바꿀 수 있게 한다.

브랜치는 execute.py가 관리하며, 브랜치 전략(`feat-recognition`)과 커밋 방식(작업 규칙 6의 형식)은 사용자와 합의가 끝났다.
이에 대해 질문하지 말고 진행하라.

## 읽어야 할 파일

- `/docs/ARCHITECTURE.md` (컴포넌트 표 C2, 판정 게이트)
- `/docs/ADR.md` (철학 "안전이 편의보다 먼저", ADR-005)
- `/src/recognition/types.ts` (`LIP_LANDMARK_INDICES`, `CORNER_A`, `CORNER_B`, `LipFrame`)
- `/src/recognition/lips.ts`, `/src/recognition/normalize.ts`, `/src/recognition/normalize.test.ts` (스타일·합성 입 모양 테스트 방식)

## 작업

테스트를 먼저 작성하고, 통과하는 구현을 작성한다 (TDD).

### 1. `src/recognition/segment.ts` — C2 구간 검출

```ts
import type { LipFrame } from "./types";

/**
 * 입 개폐량 = 안쪽 입술 위(landmark 13)·아래(landmark 14) 거리 ÷ 바깥 입꼬리(61·291) 거리.
 * 얼굴 크기·위치와 무관한 비율이다. 입꼬리 거리가 0에 가까우면(1e-6 이하) NaN.
 * 순번은 LIP_LANDMARK_INDICES.indexOf(13) · indexOf(14) · CORNER_A · CORNER_B로 구한다 (숫자를 따로 적지 마라).
 */
export function mouthOpenness(points: Float32Array): number;

export interface SegmentOptions {
  /** 휴지 기준보다 이만큼 더 벌어지면 발화 시작. 기본 0.1 */
  startDelta?: number;
  /** 마지막 움직임 기준 개폐량에서 이 폭 안에서만 변하면 '정지'. 기본 0.03 */
  stillDelta?: number;
  /** 정지가 이만큼 이어지면 구간 끝(ms). 기본 500 */
  stillMs?: number;
  /** 시작 판정 이전 이만큼(ms)의 프레임도 구간에 넣는다 — 입을 떼기 직전 움직임 포함. 기본 200 */
  preRollMs?: number;
  /** 구간(첫 프레임 ~ 마지막 움직임)이 이보다 짧으면 버린다(ms). 기본 250 */
  minMs?: number;
  /** 구간이 이보다 길어지면 버린다(ms) — 한 단어가 아니다. 기본 3000 */
  maxMs?: number;
  /** 연속 프레임 간격이 이보다 크면 진행 중 구간을 버린다(ms) — 프레임 끊김. 기본 250 */
  maxGapMs?: number;
  /** 휴지 기준(쉬는 입의 개폐량) 지수이동평균 시간 상수(ms). 기본 1000 */
  baselineTauMs?: number;
}

export const DEFAULT_SEGMENT_OPTIONS: Required<SegmentOptions>;

export class SegmentDetector {
  constructor(options?: SegmentOptions);
  /** 프레임을 하나 넣는다. 구간이 끝난 프레임이면 그 구간의 프레임 배열을, 아니면 null을 돌려준다. */
  push(frame: LipFrame): LipFrame[] | null;
  /** 진행 중 구간과 버퍼를 버리고 처음 상태로 (얼굴을 놓쳤을 때·수동 세션 OFF). 휴지 기준도 초기화. */
  reset(): void;
}
```

동작 규칙 (상태: 대기 IDLE ↔ 발화 중 ACTIVE):

1. 개폐량이 `NaN`인 프레임, `t`가 이전 프레임보다 크지 않은 프레임은 무시한다 (상태 변화 없음).
2. 이전 프레임과 간격이 `maxGapMs`보다 크면: ACTIVE였다면 진행 중 구간을 버리고 IDLE로. 휴지 기준·버퍼도 새로 시작.
3. IDLE:
   - 첫 프레임이면 휴지 기준 = 그 개폐량.
   - 개폐량 > 휴지 기준 + `startDelta`이면 ACTIVE 시작: 구간 = 최근 `preRollMs` 안의 버퍼 프레임 + 현재 프레임.
     마지막 움직임 = 현재 프레임.
   - 아니면 휴지 기준을 지수이동평균으로 갱신: `alpha = 1 - exp(-Δt / baselineTauMs)` (프레임률과 무관하게).
     프레임을 preRoll 버퍼에 넣고 `preRollMs`보다 오래된 것은 뺀다.
4. ACTIVE:
   - 프레임을 구간에 넣는다.
   - |개폐량 − 마지막 움직임 프레임의 개폐량| > `stillDelta`이면 마지막 움직임 = 현재 프레임.
   - 현재 t − 마지막 움직임 t ≥ `stillMs`이면 구간 종료:
     구간 = 첫 프레임 ~ 마지막 움직임 프레임(포함, 그 뒤 정지 프레임은 뺀다).
     (마지막 움직임 t − 첫 t) < `minMs`이면 버리고 null, 아니면 그 배열을 돌려준다. 어느 쪽이든 IDLE로 가고,
     휴지 기준은 현재 개폐량에서 다시 시작, preRoll 버퍼는 비운다.
   - 현재 t − 구간 첫 t > `maxMs`이면 구간을 버리고 IDLE로 (휴지 기준은 현재 개폐량에서 다시 시작).
5. 돌려주는 배열의 t는 엄격히 증가한다 (C3 `normalizeSegment`의 입력 조건).

### 2. 테스트 `src/recognition/segment.test.ts`

합성 좌표만 쓴다. 개폐량을 원하는 대로 조절할 수 있는 "입 모양 생성 도우미"를 테스트 파일 안에 만든다
(예: 입꼬리 거리 1, 안쪽 입술 13·14번 사이 거리 = 원하는 개폐량인 40점. 13·14번 순번은 `LIP_LANDMARK_INDICES.indexOf`로 찾는다).
개폐량 시계열 → `LipFrame[]`로 만들어 순서대로 `push`한다.

- `mouthOpenness`: 입꼬리 거리 2·안쪽 간격 0.6이면 0.3, 이동·확대·회전에 불변, 입꼬리가 겹치면 NaN
- 쉬기만 함(개폐량 0.05 ± 0.01 흔들림, 3초) → 한 번도 안 내보냄
- 단어 하나: 쉼 1초 → 0.6초 동안 0.05→0.4→0.05 → 쉼 1초 → 정확히 1구간. 첫 프레임은 개폐량이 오르기 시작한 시각의 `preRollMs` 안쪽,
  마지막 프레임은 움직임이 끝난 시각 근처(± 한 프레임), t는 엄격히 증가, `normalizeSegment`에 넣으면 null이 아니다
- 단어 두 개가 0.8초 쉼을 두고 → 2구간
- 단어 두 개가 0.3초 쉼(< stillMs)을 두고 → 1구간으로 합쳐짐
- 너무 짧은 움직임(0.1초) → 안 내보냄
- 너무 긴 움직임(4초 동안 계속 움직임) → 안 내보냄, 그 뒤 쉼 → 단어 → 정상 1구간 (회복)
- 발화 중 프레임 간격이 `maxGapMs`보다 크게 끊김 → 그 구간은 안 내보냄
- 프레임률: 같은 단어를 15fps·30fps로 → 둘 다 1구간, 구간 길이 차이 < 150ms
- 휴지 기준 적응: 살짝 벌린 채(0.12) 쉬어도 시작하지 않고, 거기서 단어를 말하면 1구간
- `reset()` 호출 → 진행 중 구간이 버려지고, 이후 새 단어는 정상 검출
- NaN 개폐량 프레임·t가 증가하지 않는 프레임은 무시된다
- 옵션 기본값 = `DEFAULT_SEGMENT_OPTIONS`, 옵션으로 `stillMs` 등을 바꾸면 동작이 바뀐다

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

- 기준값(옵션 기본값)을 테스트를 통과시키려고 바꾸지 마라 — 테스트 데이터를 규칙에 맞게 만든다. 이유: 기본값은 실제 녹화로 보정할 출발값이고, 명세가 정한 값이다.
- npm 의존성을 추가하지 마라. 이유: 새 의존성은 사용자 승인 대상이고, 이 step은 순수 TypeScript로 충분하다.
- `src/types/recognition.ts`, `src/lib/phrases.ts`, `src/recognition/gate.ts`, `src/recognition/mockRecognizer.ts`, `src/recognition/types.ts`, `src/recognition/normalize.ts`, `src/recognition/dtw.ts`, `src/recognition/lips.ts`를 수정하지 마라.
  이유: A와 합의한 계약·A의 구현이거나 이미 검수된 산출물이다.
- `src/recognition/`에서 fetch·XMLHttpRequest·WebSocket 등 네트워크 호출을 하지 마라.
  이유: CLAUDE.md CRITICAL — 고정 문장 경로는 단말에서 네트워크 없이 끝난다.
- 실제 녹화 영상·입술 좌표 파일을 레포에 추가하지 마라(테스트 픽스처 포함).
  이유: 생체정보 성격의 학습 데이터이고 GitHub는 국외 서버다 (CLAUDE.md: 수집 학습 데이터 국외 반출 금지).
- MediaPipe·카메라·DOM에 의존하는 코드를 만들지 마라. 이유: 이 step은 Node 환경(vitest `environment: node`) 순수 로직이다.
- 브랜치를 만들거나 바꾸지 말고, push하지 마라. 이유: 브랜치는 execute.py가 관리하고, push는 사용자 지시가 있을 때만 한다. 커밋은 작업 규칙 6의 형식대로 한다.
- 기존 테스트를 깨뜨리지 마라.
