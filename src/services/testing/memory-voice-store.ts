import type { PhraseAudioRow, VoiceStore } from "../voice-store";

// 테스트 전용 VoiceStore. 저장한 오디오(audio)와 phrase_audio 행(rows)을 그대로 노출한다.
export function createMemoryVoiceStore() {
  const audio = new Map<string, ArrayBuffer>();
  const rows: PhraseAudioRow[] = [];

  const store: VoiceStore = {
    async putAudio(path, data) {
      audio.set(path, data);
    },

    async listPhraseAudio(voiceProfileId) {
      return rows.filter((r) => r.voiceProfileId === voiceProfileId).map((r) => ({ ...r }));
    },

    // phrase_audio의 unique (voice_profile_id, phrase_id)와 같은 규칙
    async upsertPhraseAudio(row) {
      const i = rows.findIndex(
        (r) => r.voiceProfileId === row.voiceProfileId && r.phraseId === row.phraseId,
      );
      if (i === -1) rows.push({ ...row });
      else rows[i] = { ...row };
    },
  };

  return { ...store, audio, rows };
}
