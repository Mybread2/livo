import type { PhraseId } from "@/lib/phrases";

// GET /api/bundle/:subject_id 응답. 서버(src/services/bundle.ts)와 단말이 공유한다.
// ElevenLabs voice_id나 참조 음성 경로는 넣지 않는다 — 단말에는 재생할 오디오만 있으면 된다.
export interface VoiceBundle {
  version: string; // voice_profile_id 또는 'preset:{preset_key}'. 단말이 목소리 교체를 감지하는 키
  source: "preset" | "self" | "family";
  items: { phraseId: PhraseId; url: string }[]; // 서명 URL, PHRASES 순서
  expiresAt: string; // ISO 8601. 서명 URL 만료 시각
}
