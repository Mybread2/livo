import { describe, it, expect } from "vitest";
import { DEFAULT_BAND, dtwDistance, frameDistance, nearestPhrases, type TemplateSet } from "./dtw";
import { FEATURE_DIM, SEQ_FRAMES, type Sequence } from "./types";

// ── 합성 시퀀스 생성 도우미 (실제 입술 좌표를 레포에 두지 않는다) ──

/** 진행도 s(0~1) → 모양 곡선 위 위치 u(0~1). 단조 증가해야 같은 모양을 다른 속도로 말한 것이 된다. */
type Warp = (s: number) => number;

const identity: Warp = (s) => s;
// 앞은 빠르게·뒤는 느리게: u = s + 0.6·s(1 − s). 대각선에서 최대 0.15 × 31 ≈ 4.7프레임 벗어난다 (DEFAULT_BAND 8 안)
const fastThenSlow: Warp = (s) => s + 0.6 * s * (1 - s);

/**
 * "말 모양" = 각 열이 서로 다른 위상의 sin 곡선인 시퀀스. 모양마다 열 사이 위상 간격(seed)이 달라서,
 * 시간을 밀거나 늘여도(DTW가 흡수할 수 있는 변화) 다른 모양의 열 관계를 만들 수 없다.
 */
function speech(seed: number, rows: number = SEQ_FRAMES, warp: Warp = identity): Sequence {
  const step = 0.37 + 0.91 * seed;
  return Array.from({ length: rows }, (_, j) => {
    const u = warp(j / (rows - 1));
    const row = new Float32Array(FEATURE_DIM);
    for (let i = 0; i < FEATURE_DIM; i++) row[i] = 0.2 * Math.sin(2 * Math.PI * u + i * step);
    return row;
  });
}

/** 0번 열에만 값을 둔 시퀀스 — 손으로 DTW 표를 계산할 수 있게 한다. */
function column0(values: number[]): Sequence {
  return values.map((v) => {
    const row = new Float32Array(FEATURE_DIM);
    row[0] = v;
    return row;
  });
}

/** 테스트 쪽 독립 구현: 유클리드 거리. */
function euclid(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

/** 프레임을 순서대로 짝지은(대각선 경로) 거리. dtwDistance와 같은 정규화(÷ (n + m)). */
function diagonalDistance(a: Sequence, b: Sequence): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += euclid(a[i], b[i]);
  return sum / (a.length + b.length);
}

const A = speech(0);
const B = speech(1);
const C = speech(2);
const warpedB = speech(1, SEQ_FRAMES, fastThenSlow);

describe("frameDistance", () => {
  it("두 프레임 사이 유클리드 거리", () => {
    const a = new Float32Array(FEATURE_DIM);
    const b = new Float32Array(FEATURE_DIM);
    b[0] = 3;
    b[FEATURE_DIM - 1] = 4;
    expect(frameDistance(a, b)).toBe(5);
    expect(frameDistance(b, b)).toBe(0);
  });
});

describe("dtwDistance (C4 거리)", () => {
  it("기본 폭은 SEQ_FRAMES의 25% = 8", () => {
    expect(DEFAULT_BAND).toBe(8);
  });

  it("같은 시퀀스끼리 거리는 0", () => {
    expect(dtwDistance(A, A)).toBe(0);
    expect(dtwDistance(warpedB, warpedB)).toBe(0);
  });

  it("대칭: d(a, b) = d(b, a)", () => {
    for (const [a, b] of [
      [A, B],
      [warpedB, C],
      [speech(0, 32), speech(1, 20)],
    ]) {
      expect(Math.abs(dtwDistance(a, b) - dtwDistance(b, a))).toBeLessThan(1e-9);
    }
  });

  it("0 이상이고 유한하다", () => {
    for (const [a, b] of [
      [A, B],
      [A, C],
      [B, warpedB],
      [speech(2, 32), speech(0, 20)],
    ]) {
      const d = dtwDistance(a, b);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(d)).toBe(true);
    }
  });

  it("손으로 계산한 작은 예: 누적 비용 ÷ (n + m)", () => {
    // |a_i − b_j| 표     b: 0  0  3      누적 D           최적 경로 (0,0)→(0,1)→(1,2)→(2,2)
    //   a=0               0  0  3        0  0  3          비용 0 + 0 + 1 + 1 = 2
    //   a=2               2  2  1        2  2  1
    //   a=2               2  2  1        4  4  2          → 2 / (3 + 3)
    expect(dtwDistance(column0([0, 2, 2]), column0([0, 0, 3]))).toBeCloseTo(2 / 6, 12);
  });

  it("시간 왜곡 허용: 앞은 빠르게·뒤는 느리게 말해도 대각선 짝짓기보다 확실히 가깝다", () => {
    const dtw = dtwDistance(warpedB, B);
    const diagonal = diagonalDistance(warpedB, B);
    expect(dtw).toBeLessThan(0.5 * diagonal);
  });

  it("모양 구분: 시간만 왜곡한 같은 모양 < 다른 모양", () => {
    const same = dtwDistance(warpedB, B);
    expect(same).toBeLessThan(dtwDistance(warpedB, A));
    expect(same).toBeLessThan(dtwDistance(warpedB, C));
  });

  it("band: 0이면 대각선 경로만 — Σ frameDistance(a[i], b[i]) / (2n)", () => {
    for (const [a, b] of [
      [warpedB, B],
      [A, C],
    ]) {
      expect(dtwDistance(a, b, { band: 0 })).toBeCloseTo(diagonalDistance(a, b), 9);
    }
  });

  it("폭 제한: |i − j| > band인 칸은 지나갈 수 없다", () => {
    // a의 앞 3프레임을 b[0] 하나에 몰아야(|i − j| = 2) 비용 0이 된다
    const a = column0([0, 0, 0, 1]);
    const b = column0([0, 1, 1, 1]);
    expect(dtwDistance(a, b, { band: 0 })).toBeCloseTo(2 / 8, 12); // 대각선: 0 + 1 + 1 + 0
    expect(dtwDistance(a, b, { band: 1 })).toBeCloseTo(1 / 8, 12); // 한 칸만 비켜 갈 수 있다
    expect(dtwDistance(a, b, { band: 2 })).toBe(0);
  });

  it("band를 안 주면 DEFAULT_BAND로 제한한다 (무제한이 아니다)", () => {
    // 5번째 프레임에서 바뀌는 신호와 20번째 프레임에서 바뀌는 신호 — 맞추려면 15프레임을 비켜 가야 한다
    const early = column0(Array.from({ length: SEQ_FRAMES }, (_, j) => (j < 5 ? 0 : 1)));
    const late = column0(Array.from({ length: SEQ_FRAMES }, (_, j) => (j < 20 ? 0 : 1)));
    expect(dtwDistance(early, late)).toBe(dtwDistance(early, late, { band: DEFAULT_BAND }));
    expect(dtwDistance(early, late, { band: SEQ_FRAMES })).toBe(0);
    expect(dtwDistance(early, late)).toBeGreaterThan(0);
  });

  it("길이가 다른 두 시퀀스(32행 · 20행)도 band가 작아도 유한한 거리가 나온다", () => {
    const long = speech(1, 32);
    const short = speech(1, 20);
    for (const band of [0, 1]) {
      expect(Number.isFinite(dtwDistance(long, short, { band }))).toBe(true);
      expect(Number.isFinite(dtwDistance(short, long, { band }))).toBe(true);
    }
  });

  describe("throw — C3가 보장하는 모양이 깨진 것은 프로그래밍 오류", () => {
    it("빈 시퀀스", () => {
      expect(() => dtwDistance([], A)).toThrow();
      expect(() => dtwDistance(A, [])).toThrow();
    });

    it("행 길이가 서로 다르거나 FEATURE_DIM이 아님", () => {
      const mixed = speech(0);
      mixed[7] = new Float32Array(FEATURE_DIM + 2);
      expect(() => dtwDistance(mixed, B)).toThrow();
      expect(() => dtwDistance(B, mixed)).toThrow();

      const allShort = speech(0).map((row) => row.slice(0, FEATURE_DIM - 2));
      expect(() => dtwDistance(allShort, allShort)).toThrow();
    });

    it("band가 음수·NaN", () => {
      expect(() => dtwDistance(A, B, { band: -1 })).toThrow();
      expect(() => dtwDistance(A, B, { band: Number.NaN })).toThrow();
    });
  });
});

describe("nearestPhrases (1-NN)", () => {
  it("서로 다른 3개 말 모양 중 B를 시간 왜곡한 질의 → label B", () => {
    const result = nearestPhrases(warpedB, { a: [A], b: [B], c: [C] });
    expect(result?.label).toBe("b");
  });

  it("d1 ≤ d2, distances에 템플릿 있는 모든 문장이 들어 있다", () => {
    const result = nearestPhrases(warpedB, { a: [A], b: [B], c: [C] });
    if (result === null) throw new Error("null이면 안 된다");
    expect(result.d1).toBeLessThanOrEqual(result.d2);
    expect(Object.keys(result.distances).sort()).toEqual(["a", "b", "c"]);
    expect(result.distances.a).toBe(dtwDistance(warpedB, A));
    expect(result.d1).toBe(result.distances.b);
    expect(result.d2).toBe(Math.min(result.distances.a, result.distances.c));
  });

  it("문장 하나에 템플릿 여러 개면 그중 최소 거리가 쓰인다", () => {
    const near = speech(1, SEQ_FRAMES, (s) => s + 0.3 * s * (1 - s));
    const far = speech(1, SEQ_FRAMES, (s) => s * s);
    const templates: TemplateSet = { a: [A], b: [far, near] };
    const result = nearestPhrases(warpedB, templates);
    expect(dtwDistance(warpedB, near)).toBeLessThan(dtwDistance(warpedB, far));
    expect(result?.distances.b).toBe(dtwDistance(warpedB, near));
    expect(result?.d1).toBe(dtwDistance(warpedB, near));
  });

  it("options(band)를 거리 계산에 넘긴다", () => {
    const result = nearestPhrases(warpedB, { a: [A], b: [B] }, { band: 0 });
    expect(result?.distances.b).toBe(dtwDistance(warpedB, B, { band: 0 }));
  });

  it("템플릿 있는 문장이 하나뿐이면 d2 = Infinity", () => {
    const result = nearestPhrases(warpedB, { a: [], b: [B] });
    expect(result?.label).toBe("b");
    expect(result?.d2).toBe(Number.POSITIVE_INFINITY);
  });

  it("템플릿이 비어 있는 문장은 무시한다", () => {
    const result = nearestPhrases(warpedB, { a: [A], b: [], c: [C] });
    expect(Object.keys(result?.distances ?? {}).sort()).toEqual(["a", "c"]);
    expect(result?.label).not.toBe("b");
  });

  it("템플릿 있는 문장이 하나도 없으면 null", () => {
    expect(nearestPhrases(warpedB, {})).toBeNull();
    expect(nearestPhrases(warpedB, { a: [], b: [] })).toBeNull();
  });

  it("동점이면 키 순서가 앞선 문장 — 이름순이 아니다", () => {
    const tied = nearestPhrases(warpedB, { zeta: [B], alpha: [B] });
    expect(tied?.label).toBe("zeta");
    expect(tied?.d2).toBe(tied?.d1);
    expect(nearestPhrases(warpedB, { alpha: [B], zeta: [B] })?.label).toBe("alpha");
  });
});
