import { describe, it, expect } from "vitest";
import { decideGate } from "./gate";

describe("decideGate (C5 판정 게이트)", () => {
  it("거절(NONE·거리 초과)은 항상 discard", () => {
    expect(decideGate({ score: 0.99, rejected: true })).toBe("discard");
  });

  it("score < 0.70 은 discard", () => {
    expect(decideGate({ score: 0.69 })).toBe("discard");
  });

  it("0.70 ≤ score < 0.90 은 show(소리 없음)", () => {
    expect(decideGate({ score: 0.7 })).toBe("show");
    expect(decideGate({ score: 0.89 })).toBe("show");
  });

  it("score ≥ 0.90 은 speak", () => {
    expect(decideGate({ score: 0.9 })).toBe("speak");
  });

  it("수동 세션은 speak 임계값이 0.80", () => {
    expect(decideGate({ score: 0.8, manualSession: true })).toBe("speak");
    expect(decideGate({ score: 0.79, manualSession: true })).toBe("show");
  });
});
