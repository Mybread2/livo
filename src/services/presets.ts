import "server-only";
import type { PhraseId } from "@/lib/phrases";

// 프리셋 목소리는 voice_profiles에 넣지 않는 전역 자산이다 (마이그레이션 주석 참고).
// 어떤 목소리를 쓸지는 키가 생긴 뒤 팀이 정한다.
export const PRESET_KEYS = ["default"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export function getPresetVoiceId(key: PresetKey): string {
  const voiceId = process.env.ELEVENLABS_PRESET_VOICE_ID;
  if (!voiceId) throw new Error(`ELEVENLABS_PRESET_VOICE_ID가 설정되지 않았다 (프리셋 ${key})`);
  return voiceId;
}

export function presetAudioPath(key: PresetKey, phraseId: PhraseId): string {
  return `presets/${key}/${phraseId}.mp3`;
}
