import { randomUUID } from "node:crypto";
import type { ConsentKind, NewVoiceProfile, PhraseAudioRow, VoiceSource, VoiceStore } from "../voice-store";

export interface MemoryConsent {
  id: string;
  subjectId: string;
  kind: ConsentKind;
  grantedAt: string;
  revokedAt: string | null;
}

export interface MemoryVoiceProfile extends Omit<NewVoiceProfile, "refAudioPath"> {
  id: string;
  refAudioPath: string | null;
  createdAt: string;
}

// 테스트 전용 VoiceStore. 저장소 상태(audio·rows·refs·profiles)를 그대로 노출하고, 계정·대상자·동의 시드 헬퍼를 둔다.
export function createMemoryVoiceStore() {
  const audio = new Map<string, ArrayBuffer>(); // phrase-audio bucket
  const refs = new Map<string, Blob>(); // voice-refs bucket
  const rows: PhraseAudioRow[] = [];
  const profiles: MemoryVoiceProfile[] = [];
  const consents: MemoryConsent[] = [];
  const subjectOwners = new Map<string, string>(); // subjectId → 계정의 user_id (accounts.user_id는 unique라 1:1)

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

    async ownsSubject(userId, subjectId) {
      return subjectOwners.get(subjectId) === userId;
    },

    async listActiveConsents(subjectId) {
      return consents
        .filter((c) => c.subjectId === subjectId && c.revokedAt === null)
        .map(({ id, kind, grantedAt }) => ({ id, kind, grantedAt }));
    },

    async createRefUploadUrl(path) {
      return { signedUrl: `memory://voice-refs/${path}?upload`, token: `token:${path}` };
    },

    async downloadRef(path) {
      const blob = refs.get(path);
      if (!blob) throw new Error(`참조 음성 없음: ${path}`);
      return blob;
    },

    async deleteRef(path) {
      refs.delete(path);
    },

    // voice_profiles의 (consent_id, subject_id) 복합 FK와 같은 규칙
    async insertVoiceProfile(row) {
      if (!consents.some((c) => c.id === row.consentId && c.subjectId === row.subjectId)) {
        throw new Error("voice_profiles 저장 실패: 대상자의 동의가 아니다");
      }
      const id = randomUUID();
      profiles.push({ id, ...row, createdAt: new Date().toISOString() });
      return { id };
    },

    async listVoiceProfiles(subjectId) {
      return profiles
        .filter((p) => p.subjectId === subjectId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
        .map(({ id, source, createdAt, consentId }) => ({ id, source, createdAt, consentId }));
    },

    async clearRefAudioPath(voiceProfileId) {
      const profile = profiles.find((p) => p.id === voiceProfileId);
      if (profile) profile.refAudioPath = null;
    },

    async signedAudioUrl(path, expiresInSec) {
      if (!audio.has(path)) throw new Error(`오디오 없음: ${path}`);
      return `memory://phrase-audio/${path}?expiresIn=${expiresInSec}`;
    },
  };

  // 계정(userId)과 그 계정의 대상자를 만들고 subjectId를 돌려준다
  function seedSubject(userId: string): string {
    const subjectId = randomUUID();
    subjectOwners.set(subjectId, userId);
    return subjectId;
  }

  function seedConsent(
    subjectId: string,
    kind: ConsentKind,
    opts: { grantedAt?: string; revokedAt?: string } = {},
  ): string {
    const id = randomUUID();
    consents.push({
      id,
      subjectId,
      kind,
      grantedAt: opts.grantedAt ?? new Date().toISOString(),
      revokedAt: opts.revokedAt ?? null,
    });
    return id;
  }

  // 음성 동의와 함께 프로필을 만든다 (consent_id NOT NULL). createdAt으로 최신 순서를 정한다
  function seedVoiceProfile(subjectId: string, source: VoiceSource, opts: { createdAt?: string } = {}): string {
    const id = randomUUID();
    profiles.push({
      id,
      subjectId,
      source,
      refAudioPath: null,
      providerVoiceId: `voice-${id}`,
      consentId: seedConsent(subjectId, source === "self" ? "voice_self" : "voice_family"),
      createdAt: opts.createdAt ?? new Date().toISOString(),
    });
    return id;
  }

  return { ...store, audio, refs, rows, profiles, consents, seedSubject, seedConsent, seedVoiceProfile };
}
