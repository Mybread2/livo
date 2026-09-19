import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_PRESET, isVoicePresetKey, VOICE_PRESETS } from "./voice-presets";

describe("목소리 팔레트", () => {
  it("성별 2 × 연령대 3, 키는 중복되지 않는다", () => {
    expect(VOICE_PRESETS).toHaveLength(6);
    expect(new Set(VOICE_PRESETS.map((p) => p.key)).size).toBe(VOICE_PRESETS.length);
  });

  it("기본 프리셋은 목록에 있다", () => {
    expect(VOICE_PRESETS.map((p) => p.key)).toContain(DEFAULT_VOICE_PRESET);
  });

  // 클라이언트도 import하는 파일이다 — voice_id 같은 필드가 끼면 단말로 나간다
  it("항목은 key·gender·ageBand·label만 가진다", () => {
    for (const preset of VOICE_PRESETS) {
      expect(Object.keys(preset).sort()).toEqual(["ageBand", "gender", "key", "label"]);
    }
  });
});

describe("isVoicePresetKey", () => {
  it("팔레트의 키는 true", () => {
    for (const { key } of VOICE_PRESETS) expect(isVoicePresetKey(key)).toBe(true);
  });

  it.each([["default"], [""], ["MALE-50S"], ["male-40s"], [1], [null], [undefined], [["male-50s"]]])(
    "%j → false",
    (value) => {
      expect(isVoicePresetKey(value)).toBe(false);
    },
  );
});
