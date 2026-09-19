import { FEATURE_DIM, SEQ_FRAMES, type Sequence } from "./types";

// C4 인식기의 거리 계산 부분(DTW 템플릿 방식). 브라우저 순수 함수 — 네트워크 없음.
// 근거: docs/ARCHITECTURE.md 컴포넌트 표 C4 · docs/ADR.md ADR-004.
// 거리 → 점수(0~1) 변환과 거절 기준은 실제 녹화 데이터의 거리 분포를 본 뒤 정한다 — 여기 두지 않는다.

/** 문장 id → 그 문장의 템플릿(정규화된 Sequence)들. 키 순서가 동점 처리 순서다. */
export type TemplateSet = Readonly<Record<string, readonly Sequence[]>>;

export interface DtwOptions {
  /** Sakoe-Chiba 폭(프레임 수). 경로가 대각선에서 이만큼까지만 벗어날 수 있다. 기본 DEFAULT_BAND. */
  band?: number;
}

/** 기본 폭 = SEQ_FRAMES의 25% (32프레임이면 8). */
export const DEFAULT_BAND = Math.round(SEQ_FRAMES * 0.25);

/** 두 프레임(길이 같은 Float32Array) 사이 유클리드 거리. */
export function frameDistance(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** 두 Sequence 사이 DTW 거리. 누적 비용을 (a.length + b.length)로 나눈 값. */
export function dtwDistance(a: Sequence, b: Sequence, options: DtwOptions = {}): number {
  const band = options.band ?? DEFAULT_BAND;
  if (!(band >= 0)) throw new RangeError(`band는 0 이상이어야 한다: ${band}`);
  assertSequence(a, "a");
  assertSequence(b, "b");

  const n = a.length;
  const m = b.length;
  // 길이가 달라도 끝 칸 (n-1, m-1)이 폭 안에 들어와야 경로가 존재한다
  const width = Math.max(band, Math.abs(n - m));

  // 누적 비용 표의 두 행만 둔다. 폭 밖 칸과 아직 없는 행(-1)은 Infinity = 지나갈 수 없음
  let prev = new Float64Array(m).fill(Number.POSITIVE_INFINITY);
  let cur = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    cur.fill(Number.POSITIVE_INFINITY);
    // band가 정수가 아니어도 |i - j| ≤ width인 정수 j만 돈다
    const lo = Math.max(0, Math.ceil(i - width));
    const hi = Math.min(m - 1, Math.floor(i + width));
    for (let j = lo; j <= hi; j++) {
      let best = prev[j]; // 위 (i-1, j)
      if (j > 0) best = Math.min(best, cur[j - 1], prev[j - 1]); // 왼쪽 (i, j-1) · 대각선 (i-1, j-1)
      if (i === 0 && j === 0) best = 0; // 시작 칸
      cur[j] = frameDistance(a[i], b[j]) + best;
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m - 1] / (n + m);
}

function assertSequence(seq: Sequence, name: string): void {
  if (seq.length === 0) throw new RangeError(`${name}가 빈 시퀀스다`);
  for (let k = 0; k < seq.length; k++) {
    if (seq[k].length !== FEATURE_DIM) {
      throw new RangeError(`${name}[${k}] 길이가 ${FEATURE_DIM}이 아니다: ${seq[k].length}`);
    }
  }
}

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
export function nearestPhrases(query: Sequence, templates: TemplateSet, options?: DtwOptions): NearestResult | null {
  let label: string | null = null;
  let d1 = Number.POSITIVE_INFINITY;
  let d2 = Number.POSITIVE_INFINITY;
  const distances: Record<string, number> = {};

  for (const [id, seqs] of Object.entries(templates)) {
    if (seqs.length === 0) continue;
    // 1-NN: 문장까지 거리 = 그 문장 템플릿들 중 가장 가까운 것
    let dist = Number.POSITIVE_INFINITY;
    for (const template of seqs) dist = Math.min(dist, dtwDistance(query, template, options));
    distances[id] = dist;

    // 엄격한 < — 동점이면 먼저 나온 문장이 1등을 지킨다
    if (label === null || dist < d1) {
      d2 = d1;
      d1 = dist;
      label = id;
    } else if (dist < d2) {
      d2 = dist;
    }
  }

  return label === null ? null : { label, d1, d2, distances };
}
