import { describe, expect, it } from "vitest";
import { PHRASES, type PhraseId } from "@/lib/phrases";
import type { VoicePresetKey } from "@/lib/voice-presets";
import { BadRequestError } from "./api";
import { presetAudioPath } from "./presets";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";
import { listVoicePresets, selectVoicePreset } from "./voice-preset";
import { ForbiddenError } from "./voice-profile";

type MemoryStore = ReturnType<typeof createMemoryVoiceStore>;

const OWNER = "user-owner";
const OTHER_USER = "user-other";
const ALL = PHRASES.map((p) => p.id);

// phraseIds까지 프리셋 오디오가 올라간 상태
function seedPreset(store: MemoryStore, key: VoicePresetKey, phraseIds: readonly PhraseId[] = ALL): void {
  for (const id of phraseIds) store.audio.set(presetAudioPath(key, id), new ArrayBuffer(1));
}

// 대상자 1명 + 완성된 female-70s + 한 문장 빠진 female-30s. 나머지 프리셋은 오디오가 없다
function setup() {
  const store = createMemoryVoiceStore();
  const subjectId = store.seedSubject(OWNER);
  seedPreset(store, "female-70s");
  seedPreset(store, "female-30s", ALL.slice(1));
  return { store, subjectId };
}

// 미리듣기 문장은 "자세 바꿔주세요"
function previewUrl(key: VoicePresetKey, expiresInSec = 600): string {
  return `memory://phrase-audio/${presetAudioPath(key, "reposition")}?expiresIn=${expiresInSec}`;
}

describe("listVoicePresets", () => {
  it("모든 문장이 올라간 프리셋만 팔레트 순서로, 미리듣기는 기본 600초 서명 URL", async () => {
    const { store } = setup();
    seedPreset(store, "male-30s"); // 나중에 올려도 순서는 VOICE_PRESETS 순서

    const presets = await listVoicePresets({ store }, {});

    expect(presets).toEqual([
      { key: "male-30s", label: "남성 · 30대", gender: "male", ageBand: "30s", previewUrl: previewUrl("male-30s") },
      { key: "female-70s", label: "여성 · 70대", gender: "female", ageBand: "70s", previewUrl: previewUrl("female-70s") },
    ]);
  });

  it("expiresInSec을 주면 그 만료로 서명한다", async () => {
    const { store } = setup();

    const presets = await listVoicePresets({ store }, { expiresInSec: 60 });

    expect(presets.map((p) => p.previewUrl)).toEqual([previewUrl("female-70s", 60)]);
  });
});

describe("selectVoicePreset", () => {
  it("완성된 프리셋을 고르면 대상자에 저장하고 키를 돌려준다", async () => {
    const { store, subjectId } = setup();

    const result = await selectVoicePreset({ store }, { userId: OWNER, subjectId, presetKey: "female-70s" });

    expect(result).toEqual({ presetKey: "female-70s" });
    expect(await store.getSubjectVoicePreset(subjectId)).toBe("female-70s");
  });

  it.each([["female-70s"], ["male-40s"]])("남의 대상자면 키(%s)와 상관없이 ForbiddenError, 저장하지 않는다", async (presetKey) => {
    const { store, subjectId } = setup();

    await expect(
      selectVoicePreset({ store }, { userId: OTHER_USER, subjectId, presetKey }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await store.getSubjectVoicePreset(subjectId)).toBeNull();
  });

  it.each([["male-40s"], ["MALE-50S"], [""], [null], [42]])("팔레트에 없는 키 %j → BadRequestError", async (presetKey) => {
    const { store, subjectId } = setup();

    await expect(
      selectVoicePreset({ store }, { userId: OWNER, subjectId, presetKey }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await store.getSubjectVoicePreset(subjectId)).toBeNull();
  });

  it.each([
    ["한 문장 빠진", "female-30s"],
    ["오디오가 없는", "male-70s"],
  ])("%s 프리셋(%s) → BadRequestError, 이전 선택은 그대로", async (_, presetKey) => {
    const { store, subjectId } = setup();
    await store.setSubjectVoicePreset(subjectId, "female-70s");

    await expect(
      selectVoicePreset({ store }, { userId: OWNER, subjectId, presetKey }),
    ).rejects.toBeInstanceOf(BadRequestError);
    expect(await store.getSubjectVoicePreset(subjectId)).toBe("female-70s");
  });
});
