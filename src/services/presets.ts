import "server-only";
import type { PhraseId } from "@/lib/phrases";
import type { VoicePresetKey } from "@/lib/voice-presets";

// 프리셋 목소리는 voice_profiles에 넣지 않는 전역 자산이다 (마이그레이션 주석 참고).
// 팀이 ElevenLabs 웹에서 만든 목소리의 voice_id. null은 아직 만들지 않은 것 — 만들면 채우고 npm run precompute:presets를 돌린다.
// 합성이 끝난 목소리는 무료 슬롯을 비우려 웹에서 지워도 된다 (이미 올라간 문장은 다시 합성하지 않는다).
// voice_id는 비밀은 아니지만 단말·번들로 내보내지 않는다.
export const PRESET_VOICE_IDS: Record<VoicePresetKey, string | null> = {
  "male-30s": null,
  "male-50s": "ld4WnBGjZkAYMoRQz6p9",
  "male-70s": null,
  "female-30s": null,
  "female-50s": null,
  "female-70s": null,
};

export function getPresetVoiceId(key: VoicePresetKey): string | null {
  return PRESET_VOICE_IDS[key];
}

export function presetAudioPrefix(key: VoicePresetKey): string {
  return `presets/${key}/`;
}

export function presetAudioPath(key: VoicePresetKey, phraseId: PhraseId): string {
  return `${presetAudioPrefix(key)}${phraseId}.mp3`;
}
