import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPhraseId, type PhraseId } from "@/lib/phrases";

const AUDIO_BUCKET = "phrase-audio";
const REF_BUCKET = "voice-refs";
const LIST_PAGE_SIZE = 100;

// consents.kind check 제약과 같다
export type ConsentKind =
  | "biometric"
  | "voice_self"
  | "voice_family"
  | "research_use"
  | "overseas_transfer"
  | "research_video"
  | "voice_retention";

// voice_profiles.source check 제약과 같다. 'preset'은 없다 — 프리셋은 voice_profiles에 넣지 않는다
export type VoiceSource = "self" | "family";

export interface NewVoiceProfile {
  subjectId: string;
  source: VoiceSource;
  refAudioPath: string;
  providerVoiceId: string;
  consentId: string;
}

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
  // phrase-audio bucket의 prefix('/'로 끝나는 폴더) 아래 파일 경로 전부
  listAudio(prefix: string): Promise<string[]>;
  listPhraseAudio(voiceProfileId: string): Promise<PhraseAudioRow[]>;
  upsertPhraseAudio(row: PhraseAudioRow): Promise<void>;
  ownsSubject(userId: string, subjectId: string): Promise<boolean>;
  // 철회되지 않은(revoked_at is null) 동의만
  listActiveConsents(subjectId: string): Promise<{ id: string; kind: ConsentKind; grantedAt: string }[]>;
  createRefUploadUrl(path: string): Promise<{ signedUrl: string; token: string }>;
  downloadRef(path: string): Promise<Blob>;
  deleteRef(path: string): Promise<void>;
  insertVoiceProfile(row: NewVoiceProfile): Promise<{ id: string }>;
  // created_at desc (최신 먼저)
  listVoiceProfiles(
    subjectId: string,
  ): Promise<{ id: string; source: VoiceSource; createdAt: string; consentId: string }[]>;
  clearRefAudioPath(voiceProfileId: string): Promise<void>;
  signedAudioUrl(path: string, expiresInSec: number): Promise<string>;
  getVoiceProfile(id: string): Promise<{
    id: string;
    subjectId: string;
    source: VoiceSource;
    providerVoiceId: string;
    consentId: string;
    refAudioPath: string | null;
  } | null>;
  getConsent(id: string): Promise<{ id: string; subjectId: string; kind: ConsentKind; revokedAt: string | null } | null>;
  // revoked_at이 null일 때만 설정한다 — 최초 철회 시각을 덮어쓰지 않는다
  revokeConsent(id: string, at: Date): Promise<void>;
  deleteAudio(paths: string[]): Promise<void>;
  // voice-refs bucket의 '{subjectId}/' 아래 전부 (등록되지 않은 업로드 포함)
  listRefs(subjectId: string): Promise<string[]>;
  // phrase_audio 행은 FK cascade
  deleteVoiceProfile(id: string): Promise<void>;
  // consents·voice_profiles·phrase_audio 행은 FK cascade. Storage 파일과 ElevenLabs voice는 남는다
  deleteSubject(subjectId: string): Promise<void>;
}

// admin은 service_role 클라이언트여야 한다. voice_profiles·phrase_audio 쓰기와 두 bucket 접근에 정책이 없다 (RLS로 막혀 있다).
// service_role은 RLS를 우회하므로 소유 확인은 ownsSubject로 호출하는 쪽(voice-profile.ts)이 한다.
export function createSupabaseVoiceStore(admin: SupabaseClient): VoiceStore {
  return {
    async putAudio(path, data) {
      const { error } = await admin.storage
        .from(AUDIO_BUCKET)
        .upload(path, data, { contentType: "audio/mpeg", upsert: true });
      if (error) throw new Error(`오디오 업로드 실패: ${error.message}`);
    },

    // 프리셋 경로는 폴더 아래 한 단계다 (presetAudioPath) — 하위 폴더로 내려가지 않는다
    async listAudio(prefix) {
      const folder = prefix.replace(/\/$/, "");
      const paths: string[] = [];
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const { data, error } = await admin.storage
          .from(AUDIO_BUCKET)
          .list(folder, { limit: LIST_PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(`오디오 목록 조회 실패: ${error.message}`);
        paths.push(...data.map((f) => `${folder}/${f.name}`));
        if (data.length < LIST_PAGE_SIZE) return paths;
      }
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

    async ownsSubject(userId, subjectId) {
      const { data, error } = await admin
        .from("subjects")
        .select("id, accounts!inner(user_id)")
        .eq("id", subjectId)
        .eq("accounts.user_id", userId)
        .maybeSingle();
      if (error) throw new Error(`대상자 소유 확인 실패: ${error.message}`);
      return data !== null;
    },

    async listActiveConsents(subjectId) {
      const { data, error } = await admin
        .from("consents")
        .select("id, kind, granted_at")
        .eq("subject_id", subjectId)
        .is("revoked_at", null);
      if (error) throw new Error(`동의 조회 실패: ${error.message}`);
      return data.map((r) => ({ id: r.id, kind: r.kind, grantedAt: r.granted_at }));
    },

    async createRefUploadUrl(path) {
      const { data, error } = await admin.storage.from(REF_BUCKET).createSignedUploadUrl(path);
      if (error) throw new Error(`참조 음성 업로드 URL 발급 실패: ${error.message}`);
      return { signedUrl: data.signedUrl, token: data.token };
    },

    async downloadRef(path) {
      const { data, error } = await admin.storage.from(REF_BUCKET).download(path);
      if (error) throw new Error(`참조 음성 다운로드 실패: ${error.message}`);
      return data;
    },

    async deleteRef(path) {
      const { error } = await admin.storage.from(REF_BUCKET).remove([path]);
      if (error) throw new Error(`참조 음성 삭제 실패: ${error.message}`);
    },

    async insertVoiceProfile(row) {
      const { data, error } = await admin
        .from("voice_profiles")
        .insert({
          subject_id: row.subjectId,
          source: row.source,
          ref_audio_path: row.refAudioPath,
          provider_voice_id: row.providerVoiceId,
          consent_id: row.consentId,
        })
        .select("id")
        .single();
      if (error) throw new Error(`voice_profiles 저장 실패: ${error.message}`);
      return { id: data.id };
    },

    async listVoiceProfiles(subjectId) {
      const { data, error } = await admin
        .from("voice_profiles")
        .select("id, source, created_at, consent_id")
        .eq("subject_id", subjectId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(`voice_profiles 조회 실패: ${error.message}`);
      return data.map((r) => ({ id: r.id, source: r.source, createdAt: r.created_at, consentId: r.consent_id }));
    },

    async clearRefAudioPath(voiceProfileId) {
      const { error } = await admin
        .from("voice_profiles")
        .update({ ref_audio_path: null })
        .eq("id", voiceProfileId);
      if (error) throw new Error(`참조 음성 경로 정리 실패: ${error.message}`);
    },

    async signedAudioUrl(path, expiresInSec) {
      const { data, error } = await admin.storage.from(AUDIO_BUCKET).createSignedUrl(path, expiresInSec);
      if (error) throw new Error(`오디오 서명 URL 발급 실패: ${error.message}`);
      return data.signedUrl;
    },

    async getVoiceProfile(id) {
      const { data, error } = await admin
        .from("voice_profiles")
        .select("id, subject_id, source, provider_voice_id, consent_id, ref_audio_path")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`voice_profiles 조회 실패: ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        subjectId: data.subject_id,
        source: data.source,
        providerVoiceId: data.provider_voice_id,
        consentId: data.consent_id,
        refAudioPath: data.ref_audio_path,
      };
    },

    async getConsent(id) {
      const { data, error } = await admin
        .from("consents")
        .select("id, subject_id, kind, revoked_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw new Error(`동의 조회 실패: ${error.message}`);
      if (!data) return null;
      return { id: data.id, subjectId: data.subject_id, kind: data.kind, revokedAt: data.revoked_at };
    },

    async revokeConsent(id, at) {
      const { error } = await admin
        .from("consents")
        .update({ revoked_at: at.toISOString() })
        .eq("id", id)
        .is("revoked_at", null);
      if (error) throw new Error(`동의 철회 실패: ${error.message}`);
    },

    async deleteAudio(paths) {
      if (paths.length === 0) return;
      const { error } = await admin.storage.from(AUDIO_BUCKET).remove(paths);
      if (error) throw new Error(`오디오 삭제 실패: ${error.message}`);
    },

    // 참조 음성 경로는 '{subjectId}/{uuid}' 한 단계다 (createRefAudioUpload)
    async listRefs(subjectId) {
      const paths: string[] = [];
      for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
        const { data, error } = await admin.storage
          .from(REF_BUCKET)
          .list(subjectId, { limit: LIST_PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
        if (error) throw new Error(`참조 음성 목록 조회 실패: ${error.message}`);
        paths.push(...data.map((f) => `${subjectId}/${f.name}`));
        if (data.length < LIST_PAGE_SIZE) return paths;
      }
    },

    async deleteVoiceProfile(id) {
      const { error } = await admin.from("voice_profiles").delete().eq("id", id);
      if (error) throw new Error(`voice_profiles 삭제 실패: ${error.message}`);
    },

    async deleteSubject(subjectId) {
      const { error } = await admin.from("subjects").delete().eq("id", subjectId);
      if (error) throw new Error(`대상자 삭제 실패: ${error.message}`);
    },
  };
}
