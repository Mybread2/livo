import { describe, expect, it, vi } from "vitest";
import { PHRASES, type PhraseId } from "@/lib/phrases";
import type { VoicePresetKey } from "@/lib/voice-presets";
import { getBundle } from "./bundle";
import { profileAudioPath } from "./precompute";
import { presetAudioPath } from "./presets";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";
import { ForbiddenError, type VoiceSource } from "./voice-profile";

type MemoryStore = ReturnType<typeof createMemoryVoiceStore>;

const OWNER = "user-owner";
const OTHER_USER = "user-other";
const ALL = PHRASES.map((p) => p.id);
const OLDER = "2026-09-01T00:00:00.000Z";
const NEWER = "2026-09-10T00:00:00.000Z";

// 대상자 1명 + 국외이전 동의 + 프리셋 오디오(전역 자산이라 늘 올라가 있다)
function setup() {
  const store = createMemoryVoiceStore();
  const subjectId = store.seedSubject(OWNER);
  const overseasConsentId = store.seedConsent(subjectId, "overseas_transfer");
  for (const id of ALL) store.audio.set(presetAudioPath("male-50s", id), new ArrayBuffer(1));
  return { store, subjectId, overseasConsentId };
}

// phraseIds까지 프리셋 오디오가 올라간 상태
function seedPreset(store: MemoryStore, key: VoicePresetKey, phraseIds: readonly PhraseId[] = ALL): void {
  for (const id of phraseIds) store.audio.set(presetAudioPath(key, id), new ArrayBuffer(1));
}

// phraseIds까지 사전 합성이 끝난 프로필
async function seedProfile(
  store: MemoryStore,
  subjectId: string,
  source: VoiceSource,
  createdAt: string,
  phraseIds: readonly PhraseId[],
): Promise<string> {
  const voiceProfileId = store.seedVoiceProfile(subjectId, source, { createdAt });
  for (const phraseId of phraseIds) {
    const audioPath = profileAudioPath(subjectId, voiceProfileId, phraseId);
    await store.putAudio(audioPath, new ArrayBuffer(1));
    await store.upsertPhraseAudio({ subjectId, phraseId, voiceProfileId, audioPath, charCount: 1 });
  }
  return voiceProfileId;
}

// 메모리 스토어의 서명 URL은 경로와 만료를 그대로 드러낸다
function urlOf(path: string, expiresInSec = 3600): string {
  return `memory://phrase-audio/${path}?expiresIn=${expiresInSec}`;
}

function profileItems(subjectId: string, profileId: string) {
  return ALL.map((id) => ({ phraseId: id, url: urlOf(profileAudioPath(subjectId, profileId, id)) }));
}

function presetItems(key: VoicePresetKey = "male-50s") {
  return ALL.map((id) => ({ phraseId: id, url: urlOf(presetAudioPath(key, id)) }));
}

function consentOf(store: MemoryStore, profileId: string): string {
  const profile = store.profiles.find((p) => p.id === profileId);
  if (!profile) throw new Error(`프로필 없음: ${profileId}`);
  return profile.consentId;
}

// revoked_at만 채운다 — 파기가 아직 안 됐거나 실패해서 오디오·phrase_audio가 그대로 남은 상태
function revoke(store: MemoryStore, consentId: string): void {
  const consent = store.consents.find((c) => c.id === consentId);
  if (!consent) throw new Error(`동의 없음: ${consentId}`);
  consent.revokedAt = "2026-09-15T00:00:00.000Z";
}

describe("getBundle", () => {
  it("프로필이 없으면 프리셋 번들: 전 문장 presets/male-50s/ 경로, 기본 만료 3600초", async () => {
    const { store, subjectId } = setup();
    const signed = vi.spyOn(store, "signedAudioUrl");

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe("preset:male-50s");
    expect(bundle.source).toBe("preset");
    expect(signed.mock.calls).toEqual(ALL.map((id) => [presetAudioPath("male-50s", id), 3600]));
    expect(bundle.items).toEqual(ALL.map((id) => ({ phraseId: id, url: urlOf(presetAudioPath("male-50s", id)) })));
  });

  it("완성된 프로필 1개면 그 프로필: version은 프로필 id, source는 프로필 source, voice_id는 없다", async () => {
    const { store, subjectId } = setup();
    const profileId = await seedProfile(store, subjectId, "family", OLDER, ALL);
    const now = new Date("2026-09-19T06:00:00.000Z");

    const bundle = await getBundle({ store, now: () => now }, { userId: OWNER, subjectId });

    expect(bundle).toEqual({
      version: profileId,
      source: "family",
      items: profileItems(subjectId, profileId),
      expiresAt: "2026-09-19T07:00:00.000Z",
    });
  });

  it("최신 프로필이 3/5만 합성됐으면 이전의 완성된 프로필을 준다", async () => {
    const { store, subjectId } = setup();
    const older = await seedProfile(store, subjectId, "family", OLDER, ALL);
    await seedProfile(store, subjectId, "self", NEWER, ALL.slice(0, 3));

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe(older);
    expect(bundle.source).toBe("family");
    expect(bundle.items).toEqual(profileItems(subjectId, older));
  });

  it("최신 프로필도 완성되면 최신 프로필을 준다 (생성 순서가 아니라 created_at 기준)", async () => {
    const { store, subjectId } = setup();
    const newer = await seedProfile(store, subjectId, "self", NEWER, ALL);
    await seedProfile(store, subjectId, "family", OLDER, ALL);

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe(newer);
    expect(bundle.source).toBe("self");
    expect(bundle.items).toEqual(profileItems(subjectId, newer));
  });

  it("부분 완료 프로필뿐이면 프리셋으로 대체한다", async () => {
    const { store, subjectId } = setup();
    await seedProfile(store, subjectId, "self", NEWER, ALL.slice(0, 3));

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe("preset:male-50s");
    expect(bundle.source).toBe("preset");
  });

  it("완성된 프로필의 음성 동의가 철회됐으면 오디오가 남아 있어도 프리셋", async () => {
    const { store, subjectId } = setup();
    const profileId = await seedProfile(store, subjectId, "family", OLDER, ALL);
    revoke(store, consentOf(store, profileId));

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe("preset:male-50s");
    expect(bundle.source).toBe("preset");
    expect(bundle.items).toEqual(presetItems());
  });

  it("최신 프로필의 동의가 철회됐으면 동의가 유효한 이전의 완성된 프로필 — 동의 조회는 한 번만", async () => {
    const { store, subjectId } = setup();
    const older = await seedProfile(store, subjectId, "family", OLDER, ALL);
    const newer = await seedProfile(store, subjectId, "self", NEWER, ALL);
    revoke(store, consentOf(store, newer));
    const listConsents = vi.spyOn(store, "listActiveConsents");

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe(older);
    expect(bundle.source).toBe("family");
    expect(bundle.items).toEqual(profileItems(subjectId, older));
    expect(listConsents.mock.calls).toEqual([[subjectId]]);
  });

  it("overseas_transfer가 철회됐으면 음성 동의가 유효한 완성된 프로필이 있어도 프리셋", async () => {
    const { store, subjectId, overseasConsentId } = setup();
    await seedProfile(store, subjectId, "self", OLDER, ALL);
    revoke(store, overseasConsentId);

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe("preset:male-50s");
    expect(bundle.source).toBe("preset");
    expect(bundle.items).toEqual(presetItems());
  });

  it("대상자가 고른 프리셋이 완성돼 있으면 그 프리셋: version은 preset:{key}", async () => {
    const { store, subjectId } = setup();
    seedPreset(store, "female-70s");
    await store.setSubjectVoicePreset(subjectId, "female-70s");

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe("preset:female-70s");
    expect(bundle.source).toBe("preset");
    expect(bundle.items).toEqual(presetItems("female-70s"));
  });

  // 클라이언트가 subjects 행을 직접 고칠 수 있다 — 응급 발화가 나가도록 에러 없이 기본 프리셋
  it.each([
    ["팔레트에 없는 키", "male-40s"],
    ["한 문장 빠진 프리셋", "female-30s"],
    ["오디오가 없는 프리셋", "male-70s"],
  ])("고른 값이 %s(%s)면 기본 프리셋", async (_, value) => {
    const { store, subjectId } = setup();
    seedPreset(store, "female-30s", ALL.slice(1));
    store.subjectPresets.set(subjectId, value);

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe("preset:male-50s");
    expect(bundle.source).toBe("preset");
    expect(bundle.items).toEqual(presetItems());
  });

  it("완성된 클로닝 프로필이 있으면 고른 프리셋보다 프로필이 우선한다", async () => {
    const { store, subjectId } = setup();
    seedPreset(store, "female-70s");
    await store.setSubjectVoicePreset(subjectId, "female-70s");
    const profileId = await seedProfile(store, subjectId, "self", OLDER, ALL);

    const bundle = await getBundle({ store }, { userId: OWNER, subjectId });

    expect(bundle.version).toBe(profileId);
    expect(bundle.source).toBe("self");
    expect(bundle.items).toEqual(profileItems(subjectId, profileId));
  });

  it("남의 대상자면 ForbiddenError, 서명 URL은 발급하지 않는다", async () => {
    const { store, subjectId } = setup();
    await seedProfile(store, subjectId, "self", OLDER, ALL);
    const signed = vi.spyOn(store, "signedAudioUrl");

    await expect(getBundle({ store }, { userId: OTHER_USER, subjectId })).rejects.toBeInstanceOf(ForbiddenError);
    expect(signed).not.toHaveBeenCalled();
  });

  it("expiresAt = now + expiresInSec, 서명 URL도 같은 만료로 발급한다", async () => {
    const { store, subjectId } = setup();
    const now = new Date("2026-09-19T06:00:00.000Z");

    const bundle = await getBundle({ store, now: () => now }, { userId: OWNER, subjectId, expiresInSec: 600 });

    expect(bundle.expiresAt).toBe("2026-09-19T06:10:00.000Z");
    expect(bundle.items.every((i) => i.url.endsWith("?expiresIn=600"))).toBe(true);
  });
});
