import "server-only";
import { PHRASES, type PhraseId } from "@/lib/phrases";
import type { ElevenLabs } from "./elevenlabs";
import { getPresetVoiceId, presetAudioPath, type PresetKey } from "./presets";
import type { VoiceStore } from "./voice-store";

type Tts = Pick<ElevenLabs, "synthesizePhrase">;

export function profileAudioPath(subjectId: string, voiceProfileId: string, phraseId: PhraseId): string {
  return `${subjectId}/${voiceProfileId}/${phraseId}.mp3`;
}

// 문장은 순차로 처리한다 (ElevenLabs 동시 요청 한도). 문장마다 합성 → 업로드 → 행 upsert 순서라
// 행이 없는 오디오를 가리키는 일이 없다. 이미 행이 있는 문장은 건너뛰어 재시도 때 크레딧을 다시 쓰지 않는다.
// 중간에 실패하면 그대로 throw한다 — 부분 완료는 괜찮다. 번들은 모든 문장이 갖춰진 프로필만 내보낸다.
export async function precomputeProfileAudio(
  deps: { store: VoiceStore; tts: Tts },
  input: { subjectId: string; voiceProfileId: string; voiceId: string },
): Promise<{ synthesized: PhraseId[]; skipped: PhraseId[] }> {
  const { store, tts } = deps;
  const { subjectId, voiceProfileId, voiceId } = input;
  const existing = new Set((await store.listPhraseAudio(voiceProfileId)).map((r) => r.phraseId));
  const synthesized: PhraseId[] = [];
  const skipped: PhraseId[] = [];

  for (const { id } of PHRASES) {
    if (existing.has(id)) {
      skipped.push(id);
      continue;
    }
    const { audio, charCount } = await tts.synthesizePhrase(id, voiceId);
    const audioPath = profileAudioPath(subjectId, voiceProfileId, id);
    await store.putAudio(audioPath, audio);
    await store.upsertPhraseAudio({ subjectId, phraseId: id, voiceProfileId, audioPath, charCount });
    synthesized.push(id);
  }

  return { synthesized, skipped };
}

// 프리셋 오디오는 phrase_audio에 넣지 않는다 (voice_profile_id NOT NULL, 프리셋은 voice_profiles 밖). 업로드만 한다.
export async function precomputePresetAudio(
  deps: { store: Pick<VoiceStore, "putAudio">; tts: Tts },
  presetKey: PresetKey,
): Promise<void> {
  const voiceId = getPresetVoiceId(presetKey);
  for (const { id } of PHRASES) {
    const { audio } = await deps.tts.synthesizePhrase(id, voiceId);
    await deps.store.putAudio(presetAudioPath(presetKey, id), audio);
  }
}
