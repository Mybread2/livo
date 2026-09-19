import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPhraseId, type PhraseId } from "@/lib/phrases";

const AUDIO_BUCKET = "phrase-audio";

export interface PhraseAudioRow {
  subjectId: string;
  phraseId: PhraseId;
  voiceProfileId: string;
  audioPath: string;
  charCount: number;
}

// 서버의 Supabase 접근은 이 인터페이스 뒤에 둔다. 테스트는 testing/memory-voice-store.ts로 한다.
export interface VoiceStore {
  putAudio(path: string, data: ArrayBuffer): Promise<void>;
  listPhraseAudio(voiceProfileId: string): Promise<PhraseAudioRow[]>;
  upsertPhraseAudio(row: PhraseAudioRow): Promise<void>;
}

// admin은 service_role 클라이언트여야 한다. phrase_audio 쓰기와 phrase-audio bucket 접근에 정책이 없다 (RLS로 막혀 있다).
export function createSupabaseVoiceStore(admin: SupabaseClient): VoiceStore {
  return {
    async putAudio(path, data) {
      const { error } = await admin.storage
        .from(AUDIO_BUCKET)
        .upload(path, data, { contentType: "audio/mpeg", upsert: true });
      if (error) throw new Error(`오디오 업로드 실패: ${error.message}`);
    },

    async listPhraseAudio(voiceProfileId) {
      const { data, error } = await admin
        .from("phrase_audio")
        .select("subject_id, phrase_id, voice_profile_id, audio_path, char_count")
        .eq("voice_profile_id", voiceProfileId);
      if (error) throw new Error(`phrase_audio 조회 실패: ${error.message}`);
      return data
        .filter((r) => isPhraseId(r.phrase_id))
        .map((r) => ({
          subjectId: r.subject_id,
          phraseId: r.phrase_id,
          voiceProfileId: r.voice_profile_id,
          audioPath: r.audio_path,
          charCount: r.char_count,
        }));
    },

    async upsertPhraseAudio(row) {
      const { error } = await admin.from("phrase_audio").upsert(
        {
          subject_id: row.subjectId,
          phrase_id: row.phraseId,
          voice_profile_id: row.voiceProfileId,
          audio_path: row.audioPath,
          char_count: row.charCount,
        },
        { onConflict: "voice_profile_id,phrase_id" },
      );
      if (error) throw new Error(`phrase_audio 저장 실패: ${error.message}`);
    },
  };
}
