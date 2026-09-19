// 목소리 팔레트: 성별·연령대별 프리셋 목소리 (기획서 §6 "1일차: 성별·연령대 프리셋"). 보호자가 가장 닮은 것을 고른다.
// 보호자 화면도 import하는 공용 정의라 voice_id를 넣지 않는다 — voice_id는 서버 전용 src/services/presets.ts에만 둔다.
export const VOICE_PRESETS = [
  { key: "male-30s", gender: "male", ageBand: "30s", label: "남성 · 30대" },
  { key: "male-50s", gender: "male", ageBand: "50s", label: "남성 · 50대" },
  { key: "male-70s", gender: "male", ageBand: "70s", label: "남성 · 70대" },
  { key: "female-30s", gender: "female", ageBand: "30s", label: "여성 · 30대" },
  { key: "female-50s", gender: "female", ageBand: "50s", label: "여성 · 50대" },
  { key: "female-70s", gender: "female", ageBand: "70s", label: "여성 · 70대" },
] as const;

export type VoicePresetKey = (typeof VOICE_PRESETS)[number]["key"];

// 대상자가 아무것도 고르지 않았을 때 쓰는 목소리
export const DEFAULT_VOICE_PRESET: VoicePresetKey = "male-50s";

export function isVoicePresetKey(value: unknown): value is VoicePresetKey {
  return typeof value === "string" && VOICE_PRESETS.some((p) => p.key === value);
}
