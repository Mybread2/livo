import { afterEach, describe, expect, it } from "vitest";
import { getPhraseText, PHRASES, type PhraseId } from "@/lib/phrases";
import type { VoicePresetKey } from "@/lib/voice-presets";
import { isPresetComplete, precomputePresetAudio, precomputeProfileAudio, profileAudioPath } from "./precompute";
import { getPresetVoiceId, PRESET_VOICE_IDS, presetAudioPath, presetAudioPrefix } from "./presets";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";

type MemoryStore = ReturnType<typeof createMemoryVoiceStore>;

const INPUT = { subjectId: "s1", voiceProfileId: "p1", voiceId: "v1" };
const ALL_IDS = PHRASES.map((p) => p.id);

function audioOf(phraseId: PhraseId, voiceId: string): ArrayBuffer {
  return new TextEncoder().encode(`${phraseId}@${voiceId}`).buffer as ArrayBuffer;
}

function fakeTts(failOnCall?: number) {
  const calls: { phraseId: PhraseId; voiceId: string }[] = [];
  return {
    calls,
    async synthesizePhrase(phraseId: PhraseId, voiceId: string) {
      calls.push({ phraseId, voiceId });
      if (calls.length === failOnCall) throw new Error("tts 실패");
      return { audio: audioOf(phraseId, voiceId), charCount: getPhraseText(phraseId).length };
    },
  };
}

const ORIGINAL_PRESET_VOICE_IDS = { ...PRESET_VOICE_IDS };
afterEach(() => {
  Object.assign(PRESET_VOICE_IDS, ORIGINAL_PRESET_VOICE_IDS);
});

describe("precomputeProfileAudio", () => {
  it("모든 문장을 합성해 profileAudioPath에 올리고 phrase_audio 행을 남긴다", async () => {
    const store = createMemoryVoiceStore();
    const tts = fakeTts();

    const result = await precomputeProfileAudio({ store, tts }, INPUT);

    expect(result).toEqual({ synthesized: ALL_IDS, skipped: [] });
    expect(tts.calls).toEqual(ALL_IDS.map((phraseId) => ({ phraseId, voiceId: "v1" })));
    expect(store.rows).toHaveLength(PHRASES.length);
    for (const { id, text } of PHRASES) {
      const audioPath = profileAudioPath("s1", "p1", id);
      expect(audioPath).toBe(`s1/p1/${id}.mp3`);
      expect(store.rows).toContainEqual({
        subjectId: "s1",
        phraseId: id,
        voiceProfileId: "p1",
        audioPath,
        charCount: text.length,
      });
      expect(store.audio.get(audioPath)).toEqual(audioOf(id, "v1"));
    }
  });

  it("문장마다 합성 → 업로드 → 행 저장 순서로, 한 문장씩 처리한다", async () => {
    const memory = createMemoryVoiceStore();
    const log: string[] = [];
    const store = {
      ...memory,
      putAudio: async (path: string, data: ArrayBuffer) => {
        log.push(`put:${path}`);
        await memory.putAudio(path, data);
      },
      upsertPhraseAudio: async (row: Parameters<typeof memory.upsertPhraseAudio>[0]) => {
        log.push(`row:${row.phraseId}`);
        await memory.upsertPhraseAudio(row);
      },
    };
    const tts = {
      async synthesizePhrase(phraseId: PhraseId, voiceId: string) {
        log.push(`tts:${phraseId}`);
        return { audio: audioOf(phraseId, voiceId), charCount: 1 };
      },
    };

    await precomputeProfileAudio({ store, tts }, INPUT);

    expect(log).toEqual(
      ALL_IDS.flatMap((id) => [`tts:${id}`, `put:s1/p1/${id}.mp3`, `row:${id}`]),
    );
  });

  it("다시 돌리면 이미 행이 있는 문장은 합성하지 않고 건너뛴다", async () => {
    const store = createMemoryVoiceStore();
    await precomputeProfileAudio({ store, tts: fakeTts() }, INPUT);
    const tts = fakeTts();

    const result = await precomputeProfileAudio({ store, tts }, INPUT);

    expect(result).toEqual({ synthesized: [], skipped: ALL_IDS });
    expect(tts.calls).toHaveLength(0);
    expect(store.rows).toHaveLength(PHRASES.length);
  });

  it("중간 문장의 합성이 실패하면 throw하고, 앞 문장의 행만 남는다", async () => {
    const store = createMemoryVoiceStore();
    const tts = fakeTts(3);
    const [first, second, third] = ALL_IDS;

    await expect(precomputeProfileAudio({ store, tts }, INPUT)).rejects.toThrow("tts 실패");

    expect(tts.calls).toHaveLength(3);
    expect(store.rows.map((r) => r.phraseId)).toEqual([first, second]);
    expect(store.audio.has(profileAudioPath("s1", "p1", third))).toBe(false);
  });

  it("실패 후 재시도하면 남은 문장만 합성한다", async () => {
    const store = createMemoryVoiceStore();
    await expect(precomputeProfileAudio({ store, tts: fakeTts(3) }, INPUT)).rejects.toThrow();
    const tts = fakeTts();

    const result = await precomputeProfileAudio({ store, tts }, INPUT);

    expect(result).toEqual({ synthesized: ALL_IDS.slice(2), skipped: ALL_IDS.slice(0, 2) });
    expect(store.rows).toHaveLength(PHRASES.length);
  });
});


// 팀이 PRESET_VOICE_IDS를 채우거나 비워도 테스트가 흔들리지 않게 voice_id는 테스트 안에서 정한다
function setPresetVoice(key: VoicePresetKey, voiceId: string | null): void {
  PRESET_VOICE_IDS[key] = voiceId;
}

function seedPresetAudio(store: MemoryStore, key: VoicePresetKey, phraseIds: readonly PhraseId[]): void {
  for (const id of phraseIds) store.audio.set(presetAudioPath(key, id), audioOf(id, "old"));
}

describe("precomputePresetAudio", () => {
  it("아무것도 없으면 모든 문장을 순서대로 합성해 presets/{key}/{phraseId}.mp3에 올리고, 행은 남기지 않는다", async () => {
    setPresetVoice("female-30s", "preset_v");
    const store = createMemoryVoiceStore();
    const tts = fakeTts();

    const result = await precomputePresetAudio({ store, tts }, "female-30s");

    expect(result).toEqual({ synthesized: ALL_IDS, skipped: [] });
    expect(tts.calls).toEqual(ALL_IDS.map((phraseId) => ({ phraseId, voiceId: "preset_v" })));
    expect([...store.audio.keys()]).toEqual(ALL_IDS.map((id) => `presets/female-30s/${id}.mp3`));
    for (const id of ALL_IDS) expect(store.audio.get(presetAudioPath("female-30s", id))).toEqual(audioOf(id, "preset_v"));
    expect(store.rows).toHaveLength(0);
  });

  it("일부가 올라가 있으면 나머지만 합성하고, 있던 파일은 덮어쓰지 않는다", async () => {
    setPresetVoice("male-70s", "preset_v");
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "male-70s", ALL_IDS.slice(0, 3));
    const tts = fakeTts();

    const result = await precomputePresetAudio({ store, tts }, "male-70s");

    expect(result).toEqual({ synthesized: ALL_IDS.slice(3), skipped: ALL_IDS.slice(0, 3) });
    expect(tts.calls.map((c) => c.phraseId)).toEqual(ALL_IDS.slice(3));
    expect(store.audio.get(presetAudioPath("male-70s", ALL_IDS[0]))).toEqual(audioOf(ALL_IDS[0], "old"));
    expect(store.audio.size).toBe(PHRASES.length);
  });

  it("전부 올라가 있으면 합성 0회 — 웹에서 목소리를 지워 voice_id가 없어도 throw하지 않는다", async () => {
    setPresetVoice("male-50s", null);
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "male-50s", ALL_IDS);
    const tts = fakeTts();

    const result = await precomputePresetAudio({ store, tts }, "male-50s");

    expect(result).toEqual({ synthesized: [], skipped: ALL_IDS });
    expect(tts.calls).toHaveLength(0);
  });

  it("합성할 문장이 남았는데 voice_id가 없으면 합성·업로드 없이 throw한다", async () => {
    setPresetVoice("female-70s", null);
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "female-70s", ALL_IDS.slice(0, 3));
    const tts = fakeTts();

    await expect(precomputePresetAudio({ store, tts }, "female-70s")).rejects.toThrow("female-70s");

    expect(tts.calls).toHaveLength(0);
    expect(store.audio.size).toBe(3);
  });

  it("다른 프리셋의 파일은 건너뛸 근거가 되지 않는다", async () => {
    setPresetVoice("male-30s", "preset_v");
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "male-50s", ALL_IDS);
    const tts = fakeTts();

    const result = await precomputePresetAudio({ store, tts }, "male-30s");

    expect(result).toEqual({ synthesized: ALL_IDS, skipped: [] });
  });
});

describe("isPresetComplete", () => {
  it("모든 문장이 올라가 있으면 true", async () => {
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "female-50s", ALL_IDS);
    expect(await isPresetComplete(store, "female-50s")).toBe(true);
  });

  it("한 문장이라도 없으면 false", async () => {
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "female-50s", ALL_IDS.slice(1));
    expect(await isPresetComplete(store, "female-50s")).toBe(false);
  });

  it("다른 프리셋이 다 있어도 이 프리셋이 없으면 false", async () => {
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "male-50s", ALL_IDS);
    expect(await isPresetComplete(store, "female-50s")).toBe(false);
  });
});

describe("프리셋 경로·목소리 표", () => {
  it("presets/{key}/ 아래 {phraseId}.mp3", () => {
    expect(presetAudioPrefix("male-50s")).toBe("presets/male-50s/");
    expect(presetAudioPath("male-50s", "pain")).toBe("presets/male-50s/pain.mp3");
  });

  it("getPresetVoiceId는 표의 값을 돌려준다 — 아직 안 만든 목소리는 null", () => {
    setPresetVoice("female-30s", null);
    setPresetVoice("male-50s", "preset_v");
    expect(getPresetVoiceId("female-30s")).toBeNull();
    expect(getPresetVoiceId("male-50s")).toBe("preset_v");
  });
});

describe("메모리 listAudio", () => {
  it("prefix 아래 경로만 전부 돌려준다", async () => {
    const store = createMemoryVoiceStore();
    seedPresetAudio(store, "male-50s", ALL_IDS);
    seedPresetAudio(store, "male-30s", ["pain"]);
    await store.putAudio("s1/p1/pain.mp3", new ArrayBuffer(1));

    const paths = await store.listAudio(presetAudioPrefix("male-50s"));

    expect(paths.sort()).toEqual(ALL_IDS.map((id) => `presets/male-50s/${id}.mp3`).sort());
    expect(await store.listAudio("presets/female-70s/")).toEqual([]);
  });
});
