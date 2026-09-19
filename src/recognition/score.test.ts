import { describe, it, expect } from "vitest";
import type { NearestResult } from "./dtw";
import { decideGate } from "./gate";
import { DEFAULT_SCORE_PARAMS, scoreNearest } from "./score";

// 거리 원자료는 레포에 두지 않는다 — 배경의 요약 수치(d1·d2)만 사례로 쓴다.

/** d1·d2만 의미 있는 NearestResult. distances는 점수 계산에 쓰이지 않는다. */
function nearest(d1: number, d2: number, label = "pain"): NearestResult {
  return { label, d1, d2, distances: {} };
}

/** 거리 → 점수 → 게이트까지 이어 붙인 결과. */
function gateOf(d1: number, d2: number, manualSession = false) {
  const { score, rejected } = scoreNearest(nearest(d1, d2));
  return decideGate({ score, rejected, manualSession });
}

describe("DEFAULT_SCORE_PARAMS", () => {
  it("거절 거리 0.2 · 비율 오프셋 1.5", () => {
    expect(DEFAULT_SCORE_PARAMS.rejectDistance).toBe(0.2);
    expect(DEFAULT_SCORE_PARAMS.ratioOffset).toBe(1.5);
  });
});

describe("scoreNearest — 점수 = clamp(1.5 − d1/d2, 0, 1)", () => {
  it("d1/d2 = 0.6 → 0.9 (발화 문턱)", () => {
    const r = scoreNearest(nearest(0.06, 0.1));
    expect(r.score).toBeCloseTo(0.9, 12);
    expect(decideGate(r)).toBe("speak");
  });

  it("d1/d2 = 0.8 → 0.7 (표시 문턱)", () => {
    const r = scoreNearest(nearest(0.1, 0.125));
    expect(r.score).toBeCloseTo(0.7, 12);
    expect(decideGate(r)).toBe("show");
  });

  it("d1/d2 = 0.5 → 1.0, 그보다 작으면 1에서 멈춘다 (상한)", () => {
    expect(scoreNearest(nearest(0.05, 0.1)).score).toBe(1);
    expect(scoreNearest(nearest(0.01, 0.1)).score).toBe(1);
  });

  it("d1/d2 = 1.0 → 0.5", () => {
    expect(scoreNearest(nearest(0.1, 0.1)).score).toBe(0.5);
  });

  it("d1/d2 > 1.5면 0에서 멈춘다 (하한)", () => {
    expect(scoreNearest(nearest(0.16, 0.1)).score).toBe(0);
  });

  it("label은 결과 그대로, 거절이 아니면 rejected false", () => {
    expect(scoreNearest(nearest(0.05, 0.1, "water"))).toEqual({ label: "water", score: 1, rejected: false });
  });
});

describe("scoreNearest → decideGate", () => {
  it("d1/d2 0.4 → speak", () => {
    expect(gateOf(0.04, 0.1)).toBe("speak");
  });

  it("d1/d2 0.7 → show", () => {
    expect(gateOf(0.07, 0.1)).toBe("show");
  });

  it("d1/d2 0.9 → discard", () => {
    expect(gateOf(0.09, 0.1)).toBe("discard");
  });

  it("수동 세션에서 d1/d2 0.65 → speak (점수 0.85 ≥ 0.80)", () => {
    expect(gateOf(0.065, 0.1, true)).toBe("speak");
    expect(gateOf(0.065, 0.1, false)).toBe("show");
  });
});

describe("실제 녹화 분석 수치 (5단어 × 3회, 하나씩 빼고 맞히기)", () => {
  it("틀린 결과였던 두 사례는 discard — 화면·소리로 나가지 않는다", () => {
    expect(gateOf(0.0757, 0.0864)).toBe("discard"); // d1/d2 0.876
    expect(gateOf(0.1046, 0.1087)).toBe("discard"); // d1/d2 0.962
  });

  it("비율이 작은 정답은 speak", () => {
    expect(gateOf(0.0334, 0.0757)).toBe("speak"); // d1/d2 0.441
  });

  it("비율이 중간인 정답은 show", () => {
    expect(gateOf(0.0987, 0.1419)).toBe("show"); // d1/d2 0.696
  });
});

describe("scoreNearest — 거절", () => {
  it("d1 > 0.2면 거절 (어느 문장과도 멀다)", () => {
    expect(scoreNearest(nearest(0.21, 0.5))).toEqual({ label: "pain", score: 0, rejected: true });
  });

  it("d1 = 0.2는 거절하지 않는다 (초과만 거절)", () => {
    expect(scoreNearest(nearest(0.2, 0.5)).rejected).toBe(false);
  });

  it("d1이 Infinity·NaN이면 거절", () => {
    expect(scoreNearest(nearest(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY))).toEqual({
      label: "pain",
      score: 0,
      rejected: true,
    });
    expect(scoreNearest(nearest(Number.NaN, 0.1))).toEqual({ label: "pain", score: 0, rejected: true });
  });

  it("d2가 Infinity(비교할 문장 없음)·NaN이면 거절", () => {
    expect(scoreNearest(nearest(0.01, Number.POSITIVE_INFINITY))).toEqual({
      label: "pain",
      score: 0,
      rejected: true,
    });
    expect(scoreNearest(nearest(0.01, Number.NaN)).rejected).toBe(true);
  });

  it("거절은 게이트에서 discard", () => {
    expect(gateOf(0.21, 0.5)).toBe("discard");
    expect(gateOf(0.01, Number.POSITIVE_INFINITY)).toBe("discard");
  });
});

describe("scoreNearest — d1 = d2 = 0", () => {
  it("두 문장이 똑같이 가까우면 거절은 아니지만 점수 0", () => {
    expect(scoreNearest(nearest(0, 0))).toEqual({ label: "pain", score: 0, rejected: false });
    expect(gateOf(0, 0)).toBe("discard");
  });
});

describe("scoreNearest — params", () => {
  it("준 값만 기본값을 덮는다", () => {
    // 거절 거리만 바꿈 → 0.25는 통과, 오프셋은 1.5 그대로 (0.25/0.5 = 0.5 → 1.0)
    expect(scoreNearest(nearest(0.25, 0.5), { rejectDistance: 0.3 })).toEqual({
      label: "pain",
      score: 1,
      rejected: false,
    });
    // 오프셋만 바꿈 → 1.2 − 0.4 = 0.8, 거절 거리는 0.2 그대로
    expect(scoreNearest(nearest(0.04, 0.1), { ratioOffset: 1.2 }).score).toBeCloseTo(0.8, 12);
    expect(scoreNearest(nearest(0.21, 0.5), { ratioOffset: 1.2 }).rejected).toBe(true);
  });

  it("undefined로 준 값은 기본값을 덮지 않는다", () => {
    expect(scoreNearest(nearest(0.04, 0.1), { rejectDistance: undefined, ratioOffset: undefined })).toEqual(
      scoreNearest(nearest(0.04, 0.1)),
    );
  });

  it("rejectDistance 0은 허용 — d1 > 0이면 모두 거절", () => {
    expect(scoreNearest(nearest(0.01, 0.1), { rejectDistance: 0 }).rejected).toBe(true);
  });

  it("잘못된 params는 RangeError", () => {
    expect(() => scoreNearest(nearest(0.04, 0.1), { rejectDistance: -0.1 })).toThrow(RangeError);
    expect(() => scoreNearest(nearest(0.04, 0.1), { rejectDistance: Number.NaN })).toThrow(RangeError);
    expect(() => scoreNearest(nearest(0.04, 0.1), { rejectDistance: Number.POSITIVE_INFINITY })).toThrow(RangeError);
    expect(() => scoreNearest(nearest(0.04, 0.1), { ratioOffset: Number.NaN })).toThrow(RangeError);
    expect(() => scoreNearest(nearest(0.04, 0.1), { ratioOffset: Number.NEGATIVE_INFINITY })).toThrow(RangeError);
  });

  it("기본값은 바꿀 수 없다", () => {
    expect(Object.isFrozen(DEFAULT_SCORE_PARAMS)).toBe(true);
  });
});
