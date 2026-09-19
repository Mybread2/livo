import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PHRASES } from "@/lib/phrases";
import { ElevenLabsError, type ElevenLabs } from "./elevenlabs";
import { profileAudioPath } from "./precompute";
import { deleteSubject, purgeVoiceProfile, revokeConsent } from "./purge";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";
import { ForbiddenError } from "./voice-profile";
import type { VoiceSource } from "./voice-store";

type MemoryStore = ReturnType<typeof createMemoryVoiceStore>;

const OWNER = "user-owner";
const OTHER_USER = "user-other";
const T1 = new Date("2026-09-19T01:00:00.000Z");
const T2 = new Date("2026-09-19T02:00:00.000Z");

function fakeTts() {
  return { deleteVoice: vi.fn<ElevenLabs["deleteVoice"]>(async () => {}) };
}

function setup() {
  const store = createMemoryVoiceStore();
  const subjectId = store.seedSubject(OWNER);
  return { store, tts: fakeTts(), subjectId };
}

// 사전 합성이 끝나고 참조 음성 원본을 보관 중인 프로필
async function seedProfile(store: MemoryStore, subjectId: string, consentId: string, source: VoiceSource = "self") {
  const voiceId = `voice-${randomUUID()}`;
  const refAudioPath = `${subjectId}/${randomUUID()}`;
  store.refs.set(refAudioPath, new Blob(["ref"]));
  const { id } = await store.insertVoiceProfile({ subjectId, source, refAudioPath, providerVoiceId: voiceId, consentId });
  const audioPaths = PHRASES.map((p) => profileAudioPath(subjectId, id, p.id));
  for (const [i, { id: phraseId }] of PHRASES.entries()) {
    await store.putAudio(audioPaths[i], new ArrayBuffer(1));
    await store.upsertPhraseAudio({ subjectId, phraseId, voiceProfileId: id, audioPath: audioPaths[i], charCount: 1 });
  }
  return { id, voiceId, refAudioPath, audioPaths };
}

type Seeded = Awaited<ReturnType<typeof seedProfile>>;

function isGone(store: MemoryStore, p: Seeded): boolean {
  return (
    !store.profiles.some((x) => x.id === p.id) &&
    !store.rows.some((r) => r.voiceProfileId === p.id) &&
    p.audioPaths.every((path) => !store.audio.has(path)) &&
    !store.refs.has(p.refAudioPath)
  );
}

function isIntact(store: MemoryStore, p: Seeded): boolean {
  return (
    store.profiles.some((x) => x.id === p.id) &&
    store.rows.filter((r) => r.voiceProfileId === p.id).length === PHRASES.length &&
    p.audioPaths.every((path) => store.audio.has(path)) &&
    store.refs.has(p.refAudioPath)
  );
}

function revokedAt(store: MemoryStore, consentId: string): string | null | undefined {
  return store.consents.find((c) => c.id === consentId)?.revokedAt;
}

// 파기·철회에 쓰이는 쓰기 호출 전부
function spyWrites(store: MemoryStore, tts: ReturnType<typeof fakeTts>) {
  return [
    tts.deleteVoice,
    vi.spyOn(store, "revokeConsent"),
    vi.spyOn(store, "deleteAudio"),
    vi.spyOn(store, "deleteRef"),
    vi.spyOn(store, "clearRefAudioPath"),
    vi.spyOn(store, "deleteVoiceProfile"),
    vi.spyOn(store, "deleteSubject"),
  ];
}

describe("purgeVoiceProfile", () => {
  it("voice → 사전 합성 오디오 → 보관 원본을 지우고 행은 마지막에 지운다", async () => {
    const { store, tts, subjectId } = setup();
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    const deleteAudio = vi.spyOn(store, "deleteAudio");
    const deleteRef = vi.spyOn(store, "deleteRef");
    const deleteRow = vi.spyOn(store, "deleteVoiceProfile");

    await purgeVoiceProfile({ store, tts }, profile.id);

    expect(tts.deleteVoice).toHaveBeenCalledWith(profile.voiceId);
    expect(deleteAudio).toHaveBeenCalledWith(profile.audioPaths);
    expect(deleteRef).toHaveBeenCalledWith(profile.refAudioPath);
    expect(isGone(store, profile)).toBe(true);
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
    expect(order(deleteRow)).toBeGreaterThan(Math.max(order(tts.deleteVoice), order(deleteAudio), order(deleteRef)));
  });

  it("보관 원본이 없으면 deleteRef를 부르지 않는다", async () => {
    const { store, tts, subjectId } = setup();
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    await store.deleteRef(profile.refAudioPath);
    await store.clearRefAudioPath(profile.id);
    const deleteRef = vi.spyOn(store, "deleteRef");

    await purgeVoiceProfile({ store, tts }, profile.id);

    expect(deleteRef).not.toHaveBeenCalled();
    expect(isGone(store, profile)).toBe(true);
  });

  it("deleteVoice가 404면 이미 지워진 것으로 보고 나머지를 끝낸다", async () => {
    const { store, tts, subjectId } = setup();
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    tts.deleteVoice.mockRejectedValue(new ElevenLabsError(404, "voices/delete"));

    await purgeVoiceProfile({ store, tts }, profile.id);

    expect(isGone(store, profile)).toBe(true);
  });

  it("deleteVoice가 500이면 throw하고 오디오·원본·행은 남는다", async () => {
    const { store, tts, subjectId } = setup();
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    tts.deleteVoice.mockRejectedValue(new ElevenLabsError(500, "voices/delete"));

    await expect(purgeVoiceProfile({ store, tts }, profile.id)).rejects.toMatchObject({ status: 500 });

    expect(isIntact(store, profile)).toBe(true);
  });

  it("중간에 실패하면 다시 불러 이어서 끝내고, 끝난 뒤에는 불러도 아무것도 하지 않는다", async () => {
    const { store, tts, subjectId } = setup();
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    vi.spyOn(store, "deleteAudio").mockRejectedValueOnce(new Error("storage down"));

    await expect(purgeVoiceProfile({ store, tts }, profile.id)).rejects.toThrow("storage down");
    expect(store.profiles.some((p) => p.id === profile.id)).toBe(true);

    // voice는 첫 호출에서 지워졌다
    tts.deleteVoice.mockRejectedValue(new ElevenLabsError(404, "voices/delete"));
    await purgeVoiceProfile({ store, tts }, profile.id);
    expect(isGone(store, profile)).toBe(true);

    tts.deleteVoice.mockClear();
    await purgeVoiceProfile({ store, tts }, profile.id);
    expect(tts.deleteVoice).not.toHaveBeenCalled();
  });
});

describe("revokeConsent", () => {
  it("voice_family: 그 동의의 프로필만 파기하고 voice_self 프로필은 남긴다. 철회 시각을 기록한다", async () => {
    const { store, tts, subjectId } = setup();
    const familyConsent = store.seedConsent(subjectId, "voice_family");
    const selfConsent = store.seedConsent(subjectId, "voice_self");
    const family1 = await seedProfile(store, subjectId, familyConsent, "family");
    const family2 = await seedProfile(store, subjectId, familyConsent, "family");
    const self = await seedProfile(store, subjectId, selfConsent, "self");

    const result = await revokeConsent(
      { store, tts, now: () => T1 },
      { userId: OWNER, consentId: familyConsent },
    );

    expect(new Set(result.purgedProfileIds)).toEqual(new Set([family1.id, family2.id]));
    expect(isGone(store, family1)).toBe(true);
    expect(isGone(store, family2)).toBe(true);
    expect(isIntact(store, self)).toBe(true);
    expect(tts.deleteVoice).not.toHaveBeenCalledWith(self.voiceId);
    expect(revokedAt(store, familyConsent)).toBe(T1.toISOString());
    expect(revokedAt(store, selfConsent)).toBeNull();
  });

  it("overseas_transfer: 대상자의 프로필을 전부 파기한다", async () => {
    const { store, tts, subjectId } = setup();
    const overseas = store.seedConsent(subjectId, "overseas_transfer");
    const self = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"), "self");
    const family = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_family"), "family");

    const result = await revokeConsent({ store, tts, now: () => T1 }, { userId: OWNER, consentId: overseas });

    expect(new Set(result.purgedProfileIds)).toEqual(new Set([self.id, family.id]));
    expect(isGone(store, self)).toBe(true);
    expect(isGone(store, family)).toBe(true);
    expect(revokedAt(store, overseas)).toBe(T1.toISOString());
  });

  it("voice_retention: 참조 음성 파일을 전부(등록 안 된 업로드 포함) 지우고, 프로필은 남기되 refAudioPath는 null", async () => {
    const { store, tts, subjectId } = setup();
    const retention = store.seedConsent(subjectId, "voice_retention");
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    const pendingUpload = `${subjectId}/${randomUUID()}`;
    store.refs.set(pendingUpload, new Blob(["pending"]));

    const result = await revokeConsent({ store, tts, now: () => T1 }, { userId: OWNER, consentId: retention });

    expect(result.purgedProfileIds).toEqual([]);
    expect(store.refs.has(profile.refAudioPath)).toBe(false);
    expect(store.refs.has(pendingUpload)).toBe(false);
    expect(store.profiles.find((p) => p.id === profile.id)?.refAudioPath).toBeNull();
    expect(profile.audioPaths.every((path) => store.audio.has(path))).toBe(true);
    expect(tts.deleteVoice).not.toHaveBeenCalled();
    expect(revokedAt(store, retention)).toBe(T1.toISOString());
  });

  it("biometric: 철회만 기록하고 파기 호출은 0회", async () => {
    const { store, tts, subjectId } = setup();
    const biometric = store.seedConsent(subjectId, "biometric");
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    const [, revoke, ...purges] = spyWrites(store, tts);

    const result = await revokeConsent({ store, tts, now: () => T1 }, { userId: OWNER, consentId: biometric });

    expect(result.purgedProfileIds).toEqual([]);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(tts.deleteVoice).not.toHaveBeenCalled();
    for (const spy of purges) expect(spy).not.toHaveBeenCalled();
    expect(isIntact(store, profile)).toBe(true);
    expect(revokedAt(store, biometric)).toBe(T1.toISOString());
  });

  it("파기가 실패해도 철회는 기록돼 있고, 다시 부르면 파기를 끝내며 최초 철회 시각은 그대로다", async () => {
    const { store, tts, subjectId } = setup();
    const consentId = store.seedConsent(subjectId, "voice_self");
    const profile = await seedProfile(store, subjectId, consentId);
    tts.deleteVoice.mockRejectedValueOnce(new ElevenLabsError(500, "voices/delete"));

    await expect(
      revokeConsent({ store, tts, now: () => T1 }, { userId: OWNER, consentId }),
    ).rejects.toBeInstanceOf(ElevenLabsError);
    expect(revokedAt(store, consentId)).toBe(T1.toISOString());
    expect(isIntact(store, profile)).toBe(true);

    const result = await revokeConsent({ store, tts, now: () => T2 }, { userId: OWNER, consentId });

    expect(result.purgedProfileIds).toEqual([profile.id]);
    expect(isGone(store, profile)).toBe(true);
    expect(revokedAt(store, consentId)).toBe(T1.toISOString());
  });

  it("남의 동의이거나 없는 동의면 ForbiddenError, 쓰기 0회", async () => {
    const { store, tts, subjectId } = setup();
    const consentId = store.seedConsent(subjectId, "voice_self");
    const profile = await seedProfile(store, subjectId, consentId);
    const writes = spyWrites(store, tts);

    await expect(
      revokeConsent({ store, tts }, { userId: OTHER_USER, consentId }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      revokeConsent({ store, tts }, { userId: OWNER, consentId: randomUUID() }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(revokedAt(store, consentId)).toBeNull();
    expect(isIntact(store, profile)).toBe(true);
  });
});

describe("deleteSubject", () => {
  it("프로필·오디오·원본·등록 안 된 업로드를 지운 뒤 대상자 행을 지운다. 같은 계정의 다른 대상자는 그대로다", async () => {
    const { store, tts, subjectId } = setup();
    const self = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"), "self");
    const family = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_family"), "family");
    const pendingUpload = `${subjectId}/${randomUUID()}`;
    store.refs.set(pendingUpload, new Blob(["pending"]));
    const otherSubject = store.seedSubject(OWNER);
    const otherUpload = `${otherSubject}/${randomUUID()}`;
    store.refs.set(otherUpload, new Blob(["other"]));
    const deleteRow = vi.spyOn(store, "deleteSubject");

    await deleteSubject({ store, tts }, { userId: OWNER, subjectId });

    expect(new Set(tts.deleteVoice.mock.calls.map(([v]) => v))).toEqual(new Set([self.voiceId, family.voiceId]));
    expect(isGone(store, self)).toBe(true);
    expect(isGone(store, family)).toBe(true);
    expect(store.refs.has(pendingUpload)).toBe(false);
    expect(store.refs.has(otherUpload)).toBe(true);
    expect(deleteRow).toHaveBeenCalledWith(subjectId);
    expect(await store.ownsSubject(OWNER, subjectId)).toBe(false);
    expect(store.consents.some((c) => c.subjectId === subjectId)).toBe(false);
    expect(await store.ownsSubject(OWNER, otherSubject)).toBe(true);
  });

  it("파기가 실패하면 throw하고 대상자 행은 남는다", async () => {
    const { store, tts, subjectId } = setup();
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    tts.deleteVoice.mockRejectedValue(new ElevenLabsError(500, "voices/delete"));

    await expect(deleteSubject({ store, tts }, { userId: OWNER, subjectId })).rejects.toBeInstanceOf(ElevenLabsError);

    expect(await store.ownsSubject(OWNER, subjectId)).toBe(true);
    expect(isIntact(store, profile)).toBe(true);
  });

  it("남의 대상자면 ForbiddenError, 쓰기 0회", async () => {
    const { store, tts, subjectId } = setup();
    const profile = await seedProfile(store, subjectId, store.seedConsent(subjectId, "voice_self"));
    const writes = spyWrites(store, tts);

    await expect(
      deleteSubject({ store, tts }, { userId: OTHER_USER, subjectId }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    expect(await store.ownsSubject(OWNER, subjectId)).toBe(true);
    expect(isIntact(store, profile)).toBe(true);
  });
});
