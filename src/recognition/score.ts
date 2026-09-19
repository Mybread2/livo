import type { NearestResult } from "./dtw";

// C4 인식기의 마지막 부분: DTW 거리 → 게이트가 받는 0~1 점수 + 거절. 브라우저 순수 함수 — 네트워크 없음.
// 근거: docs/ARCHITECTURE.md "판정 게이트(C5)" · docs/ADR.md ADR-004 · ADR-005.
// 점수는 1·2위 거리 비율 d1/d2로 잰다 — 1위가 2위보다 뚜렷이 가까울수록 확신한다.
// 애매하면 안 나오는 쪽: 비교 대상이 없거나 어느 문장과도 멀면 거절한다.

export interface ScoreParams {
  /** d1이 이보다 크면 거절(NONE). 기본 0.2 */
  rejectDistance: number;
  /** 점수 = clamp(ratioOffset − d1/d2, 0, 1). 기본 1.5 */
  ratioOffset: number;
}

/** 출발값 — 실제 녹화(5단어 × 3회) 분석으로 정했다. 비발화 녹화로 거절 거리를 보정한다. */
export const DEFAULT_SCORE_PARAMS: Readonly<ScoreParams> = Object.freeze({
  // 같은 단어끼리 최대 거리 0.185 바로 위
  rejectDistance: 0.2,
  // d1/d2 ≤ 0.6 → 0.9 이상(발화) · 0.6~0.8 → 글자만 · > 0.8 → 버림
  ratioOffset: 1.5,
});

export interface ScoredResult {
  label: string;
  score: number; // 0~1
  rejected: boolean; // true면 게이트가 discard
}

export function scoreNearest(result: NearestResult, params: Partial<ScoreParams> = {}): ScoredResult {
  const rejectDistance = params.rejectDistance ?? DEFAULT_SCORE_PARAMS.rejectDistance;
  const ratioOffset = params.ratioOffset ?? DEFAULT_SCORE_PARAMS.ratioOffset;
  if (!Number.isFinite(rejectDistance) || rejectDistance < 0) {
    throw new RangeError(`rejectDistance는 0 이상의 유한수여야 한다: ${rejectDistance}`);
  }
  if (!Number.isFinite(ratioOffset)) throw new RangeError(`ratioOffset은 유한수여야 한다: ${ratioOffset}`);

  const { label, d1, d2 } = result;
  // 어느 문장과도 멀다 = NONE
  if (!Number.isFinite(d1) || d1 > rejectDistance) return { label, score: 0, rejected: true };
  // 템플릿 있는 문장이 하나뿐 — 비교 대상이 없어 확신도를 잴 수 없다
  if (!Number.isFinite(d2)) return { label, score: 0, rejected: true };
  // d1 = d2 = 0 — 두 문장이 똑같이 가깝다. 0으로 나누지 않고 가장 낮은 점수
  if (d2 <= 0) return { label, score: 0, rejected: false };

  const score = Math.min(1, Math.max(0, ratioOffset - d1 / d2));
  return { label, score, rejected: false };
}
