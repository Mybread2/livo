import { describe, it, expect } from "vitest";
import { PHRASES, getPhrase, STARTER_PHRASE_IDS } from "./phrases";

describe("고정 문장 목록", () => {
  it("전역 문장 15개", () => {
    expect(PHRASES).toHaveLength(15);
  });

  it("응급(T0)은 4개이고 모두 emergency=true", () => {
    const t0 = PHRASES.filter((p) => p.tier === "T0");
    expect(t0).toHaveLength(4);
    expect(t0.every((p) => p.emergency)).toBe(true);
  });

  it("id는 중복되지 않는다", () => {
    const ids = new Set(PHRASES.map((p) => p.id));
    expect(ids.size).toBe(PHRASES.length);
  });

  it("시작 단어 셋은 모두 실제 문장이다", () => {
    for (const id of STARTER_PHRASE_IDS) {
      expect(getPhrase(id)).toBeDefined();
    }
  });
});
