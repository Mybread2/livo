import "server-only";
import { PHRASES, type PhraseId } from "@/lib/phrases";
import type { VoicePresetKey } from "@/lib/voice-presets";
import type { ElevenLabs } from "./elevenlabs";
import { getPresetVoiceId, presetAudioPath, presetAudioPrefix } from "./presets";
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
// 이미 올라간 문장은 건너뛴다 — 팀은 합성 후 웹에서 목소리를 지우므로, 다시 돌려도 호출이 0회여야 한다.
// 합성할 문장이 남았는데 voice_id가 없으면(아직 안 만든 목소리) throw한다. 순차 처리는 precomputeProfileAudio와 같은 이유.
export async function precomputePresetAudio(
  deps: { store: Pick<VoiceStore, "putAudio" | "listAudio">; tts: Tts },
  presetKey: VoicePresetKey,
): Promise<{ synthesized: PhraseId[]; skipped: PhraseId[] }> {
  const { store, tts } = deps;
  const existing = new Set(await store.listAudio(presetAudioPrefix(presetKey)));
  const voiceId = getPresetVoiceId(presetKey);
  const synthesized: PhraseId[] = [];
  const skipped: PhraseId[] = [];

  for (const { id } of PHRASES) {
    const path = presetAudioPath(presetKey, id);
    if (existing.has(path)) {
      skipped.push(id);
      continue;
    }
    if (voiceId === null) throw new Error(`프리셋 ${presetKey}의 voice_id가 없다 (PRESET_VOICE_IDS)`);
    const { audio } = await tts.synthesizePhrase(id, voiceId);
    await store.putAudio(path, audio);
    synthesized.push(id);
  }

  return { synthesized, skipped };
}

// 모든 등록 문장의 프리셋 오디오가 올라가 있는지
export async function isPresetComplete(store: Pick<VoiceStore, "listAudio">, key: VoicePresetKey): Promise<boolean> {
  const existing = new Set(await store.listAudio(presetAudioPrefix(key)));
  return PHRASES.every(({ id }) => existing.has(presetAudioPath(key, id)));
}
