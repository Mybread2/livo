import { describe, it, expect } from "vitest";
import { PHRASES, getPhrase, STARTER_PHRASE_IDS, getPhraseText, isPhraseId, type PhraseId } from "./phrases";

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

  it("모든 text가 비어 있지 않다", () => {
    for (const p of PHRASES) {
      expect(p.text.trim()).not.toBe("");
    }
  });
});

describe("isPhraseId", () => {
  it("등록된 id는 true", () => {
    for (const p of PHRASES) {
      expect(isPhraseId(p.id)).toBe(true);
    }
  });

  it("문장 텍스트·빈 문자열·숫자·undefined는 false", () => {
    expect(isPhraseId("네")).toBe(false);
    expect(isPhraseId("")).toBe(false);
    expect(isPhraseId(0)).toBe(false);
    expect(isPhraseId(undefined)).toBe(false);
  });
});

describe("getPhraseText", () => {
  it("id로 문장 텍스트를 찾는다", () => {
    expect(getPhraseText("pain")).toBe("아파요");
  });

  it("미등록 값이 캐스팅되어 들어오면 throw한다", () => {
    expect(() => getPhraseText("hello" as PhraseId)).toThrow();
  });
});
