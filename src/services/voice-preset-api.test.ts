import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHRASES, type PhraseId } from "@/lib/phrases";
import type { VoicePresetKey } from "@/lib/voice-presets";
import type { VoiceApiContext } from "./api";
import type { ElevenLabs } from "./elevenlabs";
import { PRESET_VOICE_IDS, presetAudioPath } from "./presets";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";
import { handleListPresets, handleSelectPreset } from "./voice-preset-api";

type MemoryStore = ReturnType<typeof createMemoryVoiceStore>;

const OWNER = "user-owner";
const OTHER_USER = "user-other";
const ALL = PHRASES.map((p) => p.id);

beforeEach(() => {
  // 5xx는 errorResponse가 원인을 서버 로그에 남긴다
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// 이 라우트들은 합성·클론을 하지 않는다
function fakeTts(): ElevenLabs {
  const fail = async () => {
    throw new Error("이 라우트들은 ElevenLabs를 부르지 않는다");
  };
  return { cloneVoice: vi.fn(fail), deleteVoice: vi.fn(fail), synthesizePhrase: vi.fn(fail) };
}

function seedPreset(store: MemoryStore, key: VoicePresetKey, phraseIds: readonly PhraseId[] = ALL): void {
  for (const id of phraseIds) store.audio.set(presetAudioPath(key, id), new ArrayBuffer(1));
}

// 대상자 1명 + 완성된 male-50s(voice_id 있음)·female-70s + 한 문장 빠진 female-30s. 나머지 프리셋은 오디오가 없다
function setup(userId = OWNER) {
  const store = createMemoryVoiceStore();
  const subjectId = store.seedSubject(OWNER);
  seedPreset(store, "male-50s");
  seedPreset(store, "female-70s");
  seedPreset(store, "female-30s", ALL.slice(1));
  const ctx: VoiceApiContext = { userId, store, tts: fakeTts() };
  return { ctx, store, subjectId };
}

function previewUrl(key: VoicePresetKey): string {
  return `memory://phrase-audio/${presetAudioPath(key, "reposition")}?expiresIn=600`;
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("handleListPresets", () => {
  it("→ 200 완성된 프리셋만 snake_case로, no-store, voice_id 없음", async () => {
    const env = setup();
    const res = await handleListPresets(env.ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      presets: [
        { key: "male-50s", label: "남성 · 50대", gender: "male", age_band: "50s", preview_url: previewUrl("male-50s") },
        { key: "female-70s", label: "여성 · 70대", gender: "female", age_band: "70s", preview_url: previewUrl("female-70s") },
      ],
    });
    for (const voiceId of Object.values(PRESET_VOICE_IDS)) if (voiceId) expect(text).not.toContain(voiceId);
    expect(text).not.toMatch(/voice_id|voiceId/);
  });

  it("완성된 프리셋이 없으면 빈 목록", async () => {
    const env = setup();
    env.store.audio.clear();
    const res = await handleListPresets(env.ctx);

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ presets: [] });
  });
});

describe("handleSelectPreset", () => {
  it("완성된 프리셋 → 200 {preset_key}, 대상자에 저장", async () => {
    const env = setup();
    const res = await handleSelectPreset(env.ctx, env.subjectId, { preset_key: "female-70s" });

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ preset_key: "female-70s" });
    expect(await env.store.getSubjectVoicePreset(env.subjectId)).toBe("female-70s");
  });

  it("잘못된 uuid → 400", async () => {
    const env = setup();
    const res = await handleSelectPreset(env.ctx, "not-a-uuid", { preset_key: "female-70s" });

    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "bad_request" });
  });

  it.each([
    ["팔레트에 없는 키", { preset_key: "male-40s" }],
    ["문자열이 아닌 키", { preset_key: 42 }],
    ["키 없음", {}],
    ["한 문장 빠진 프리셋", { preset_key: "female-30s" }],
    ["오디오가 없는 프리셋", { preset_key: "male-70s" }],
  ])("%s → 400, 저장하지 않는다", async (_, body) => {
    const env = setup();
    const res = await handleSelectPreset(env.ctx, env.subjectId, body);

    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "bad_request" });
    expect(await env.store.getSubjectVoicePreset(env.subjectId)).toBeNull();
  });

  it("남의 대상자 → 403, 저장하지 않는다", async () => {
    const env = setup(OTHER_USER);
    const res = await handleSelectPreset(env.ctx, env.subjectId, { preset_key: "female-70s" });

    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: "forbidden" });
    expect(await env.store.getSubjectVoicePreset(env.subjectId)).toBeNull();
  });
});
