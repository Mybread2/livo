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

// 노출한 배열을 테스트가 들고 있으므로 제자리에서 지운다
function removeWhere<T>(list: T[], match: (item: T) => boolean): void {
  for (let i = list.length - 1; i >= 0; i--) if (match(list[i])) list.splice(i, 1);
}

// 테스트 전용 VoiceStore. 저장소 상태(audio·rows·refs·profiles)를 그대로 노출하고, 계정·대상자·동의 시드 헬퍼를 둔다.
export function createMemoryVoiceStore() {
  const audio = new Map<string, ArrayBuffer>(); // phrase-audio bucket
  const refs = new Map<string, Blob>(); // voice-refs bucket
  const rows: PhraseAudioRow[] = [];
  const profiles: MemoryVoiceProfile[] = [];
  const consents: MemoryConsent[] = [];
  const subjectOwners = new Map<string, string>(); // subjectId → 계정의 user_id (accounts.user_id는 unique라 1:1)
  // subjects.voice_preset (subjectId → 값, 없으면 null). 클라이언트의 직접 수정을 흉내 내려 아무 문자열이나 넣을 수 있다
  const subjectPresets = new Map<string, string>();

  const store: VoiceStore = {
    async putAudio(path, data) {
      audio.set(path, data);
    },

    async listAudio(prefix) {
      return [...audio.keys()].filter((path) => path.startsWith(prefix));
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

    async getVoiceProfile(id) {
      const p = profiles.find((x) => x.id === id);
      if (!p) return null;
      const { subjectId, source, providerVoiceId, consentId, refAudioPath } = p;
      return { id, subjectId, source, providerVoiceId, consentId, refAudioPath };
    },

    async getConsent(id) {
      const c = consents.find((x) => x.id === id);
      return c ? { id, subjectId: c.subjectId, kind: c.kind, revokedAt: c.revokedAt } : null;
    },

    async revokeConsent(id, at) {
      const consent = consents.find((c) => c.id === id);
      if (consent && consent.revokedAt === null) consent.revokedAt = at.toISOString();
    },

    async deleteAudio(paths) {
      for (const path of paths) audio.delete(path);
    },

    async listRefs(subjectId) {
      return [...refs.keys()].filter((path) => path.startsWith(`${subjectId}/`));
    },

    // phrase_audio는 FK cascade
    async deleteVoiceProfile(id) {
      removeWhere(profiles, (p) => p.id === id);
      removeWhere(rows, (r) => r.voiceProfileId === id);
    },

    // consents·voice_profiles·phrase_audio는 FK cascade. Storage(audio·refs)는 DB cascade로 지워지지 않는다
    async deleteSubject(subjectId) {
      subjectOwners.delete(subjectId);
      subjectPresets.delete(subjectId);
      removeWhere(consents, (c) => c.subjectId === subjectId);
      removeWhere(profiles, (p) => p.subjectId === subjectId);
      removeWhere(rows, (r) => r.subjectId === subjectId);
    },

    async getSubjectVoicePreset(subjectId) {
      return subjectPresets.get(subjectId) ?? null;
    },

    async setSubjectVoicePreset(subjectId, key) {
      subjectPresets.set(subjectId, key);
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

  return { ...store, audio, refs, rows, profiles, consents, subjectPresets, seedSubject, seedConsent, seedVoiceProfile };
}
