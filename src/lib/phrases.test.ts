import { describe, expect, it } from "vitest";
import { PHRASES, getPhraseText, isPhraseId, type PhraseId } from "./phrases";

describe("PHRASES", () => {
  it("id가 중복되지 않는다", () => {
    const ids = PHRASES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
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
