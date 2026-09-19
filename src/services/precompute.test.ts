import { afterEach, describe, expect, it, vi } from "vitest";
import { getPhraseText, PHRASES, type PhraseId } from "@/lib/phrases";
import { precomputePresetAudio, precomputeProfileAudio, profileAudioPath } from "./precompute";
import { getPresetVoiceId, presetAudioPath } from "./presets";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";

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

afterEach(() => {
  vi.unstubAllEnvs();
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

describe("precomputePresetAudio", () => {
  it("presets/{key}/{phraseId}.mp3에 업로드만 하고 행은 남기지 않는다", async () => {
    vi.stubEnv("ELEVENLABS_PRESET_VOICE_ID", "preset_v");
    const store = createMemoryVoiceStore();
    const tts = fakeTts();

    await precomputePresetAudio({ store, tts }, "default");

    expect(tts.calls).toEqual(ALL_IDS.map((phraseId) => ({ phraseId, voiceId: "preset_v" })));
    expect([...store.audio.keys()]).toEqual(ALL_IDS.map((id) => `presets/default/${id}.mp3`));
    for (const id of ALL_IDS) {
      expect(presetAudioPath("default", id)).toBe(`presets/default/${id}.mp3`);
      expect(store.audio.get(presetAudioPath("default", id))).toEqual(audioOf(id, "preset_v"));
    }
    expect(store.rows).toHaveLength(0);
  });
});

describe("getPresetVoiceId", () => {
  it("ELEVENLABS_PRESET_VOICE_ID를 돌려준다", () => {
    vi.stubEnv("ELEVENLABS_PRESET_VOICE_ID", "preset_v");
    expect(getPresetVoiceId("default")).toBe("preset_v");
  });

  it("환경변수가 없으면 throw한다", () => {
    vi.stubEnv("ELEVENLABS_PRESET_VOICE_ID", "");
    expect(() => getPresetVoiceId("default")).toThrow();
  });
});
