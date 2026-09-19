import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PHRASES } from "@/lib/phrases";
import type { VoiceApiContext } from "./api";
import { handleBundle, handleDeleteSubject, handleRevokeConsent } from "./bundle-purge-api";
import type { ElevenLabs } from "./elevenlabs";
import { profileAudioPath } from "./precompute";
import { presetAudioPath } from "./presets";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";

type MemoryStore = ReturnType<typeof createMemoryVoiceStore>;

const OWNER = "user-owner";
const OTHER_USER = "user-other";

beforeEach(() => {
  // 5xx는 errorResponse가 원인을 서버 로그에 남긴다
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeTts() {
  return {
    cloneVoice: vi.fn<ElevenLabs["cloneVoice"]>(async () => ({ voiceId: "cloned_v" })),
    deleteVoice: vi.fn<ElevenLabs["deleteVoice"]>(async () => {}),
    synthesizePhrase: vi.fn<ElevenLabs["synthesizePhrase"]>(async () => {
      throw new Error("이 라우트들은 합성하지 않는다");
    }),
  };
}

// 대상자 1명 + 본인 음성·국외이전 동의 + 프리셋 오디오(전역 자산이라 늘 올라가 있다)
function setup(userId = OWNER) {
  const store = createMemoryVoiceStore();
  const subjectId = store.seedSubject(OWNER);
  const voiceConsentId = store.seedConsent(subjectId, "voice_self");
  store.seedConsent(subjectId, "overseas_transfer");
  for (const { id } of PHRASES) store.audio.set(presetAudioPath("male-50s", id), new ArrayBuffer(1));
  const tts = fakeTts();
  const ctx: VoiceApiContext = { userId, store, tts };
  return { ctx, store, tts, subjectId, voiceConsentId };
}

// 사전 합성이 끝나고 참조 음성 원본을 보관 중인 프로필
async function seedProfile(store: MemoryStore, subjectId: string, consentId: string) {
  const providerVoiceId = `voice-${randomUUID()}`;
  const refAudioPath = `${subjectId}/${randomUUID()}`;
  store.refs.set(refAudioPath, new Blob(["ref"]));
  const { id } = await store.insertVoiceProfile({ subjectId, source: "self", refAudioPath, providerVoiceId, consentId });
  for (const { id: phraseId } of PHRASES) {
    const audioPath = profileAudioPath(subjectId, id, phraseId);
    await store.putAudio(audioPath, new ArrayBuffer(1));
    await store.upsertPhraseAudio({ subjectId, phraseId, voiceProfileId: id, audioPath, charCount: 1 });
  }
  return { id, providerVoiceId, refAudioPath };
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

describe("handleBundle", () => {
  it("정상 → 200 {voice, recognizer: null}, no-store, voice_id·참조 음성 경로 없음", async () => {
    const env = setup();
    const profile = await seedProfile(env.store, env.subjectId, env.voiceConsentId);
    const res = await handleBundle(env.ctx, env.subjectId);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    const body = JSON.parse(text) as { voice: { version: string; items: unknown[] }; recognizer: unknown };
    expect(Object.keys(body).sort()).toEqual(["recognizer", "voice"]);
    expect(body.recognizer).toBeNull();
    expect(body.voice.version).toBe(profile.id);
    expect(body.voice.items).toHaveLength(PHRASES.length);
    expect(text).not.toContain(profile.providerVoiceId);
    expect(text).not.toContain(profile.refAudioPath);
    expect(text).not.toMatch(/provider_voice_id|providerVoiceId|ref_audio_path|refAudioPath/);
  });

  it("남의 대상자 → 403", async () => {
    const env = setup(OTHER_USER);
    const res = await handleBundle(env.ctx, env.subjectId);

    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: "forbidden" });
  });

  it("잘못된 uuid → 400", async () => {
    const env = setup();
    const res = await handleBundle(env.ctx, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "bad_request" });
  });
});

describe("handleRevokeConsent", () => {
  it("음성 동의 철회 → 200 {purged_profile_ids}, 그 동의의 프로필 파기", async () => {
    const env = setup();
    const profile = await seedProfile(env.store, env.subjectId, env.voiceConsentId);
    const res = await handleRevokeConsent(env.ctx, env.voiceConsentId);

    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ purged_profile_ids: [profile.id] });
    expect(env.store.profiles).toEqual([]);
    expect(env.tts.deleteVoice).toHaveBeenCalledWith(profile.providerVoiceId);
    expect(env.store.consents.find((c) => c.id === env.voiceConsentId)?.revokedAt).not.toBeNull();
  });

  it("남의 동의 → 403, 철회·파기하지 않는다", async () => {
    const env = setup(OTHER_USER);
    await seedProfile(env.store, env.subjectId, env.voiceConsentId);
    const res = await handleRevokeConsent(env.ctx, env.voiceConsentId);

    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: "forbidden" });
    expect(env.store.profiles).toHaveLength(1);
    expect(env.store.consents.find((c) => c.id === env.voiceConsentId)?.revokedAt).toBeNull();
  });

  it("잘못된 uuid → 400", async () => {
    const env = setup();
    const res = await handleRevokeConsent(env.ctx, "not-a-uuid");

    expect(res.status).toBe(400);
  });
});

describe("handleDeleteSubject", () => {
  it("→ 204, 대상자·프로필이 사라진다", async () => {
    const env = setup();
    const profile = await seedProfile(env.store, env.subjectId, env.voiceConsentId);
    const res = await handleDeleteSubject(env.ctx, env.subjectId);

    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await env.store.ownsSubject(OWNER, env.subjectId)).toBe(false);
    expect(env.store.profiles).toEqual([]);
    expect(env.store.refs.has(profile.refAudioPath)).toBe(false);
    expect(env.tts.deleteVoice).toHaveBeenCalledWith(profile.providerVoiceId);
  });

  it("남의 대상자 → 403, 지우지 않는다", async () => {
    const env = setup(OTHER_USER);
    await seedProfile(env.store, env.subjectId, env.voiceConsentId);
    const res = await handleDeleteSubject(env.ctx, env.subjectId);

    expect(res.status).toBe(403);
    expect(await env.store.ownsSubject(OWNER, env.subjectId)).toBe(true);
    expect(env.store.profiles).toHaveLength(1);
  });

  it("잘못된 uuid → 400", async () => {
    const env = setup();
    const res = await handleDeleteSubject(env.ctx, "not-a-uuid");

    expect(res.status).toBe(400);
  });
});
