import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPhraseText, PHRASES, type PhraseId } from "@/lib/phrases";
import type { VoiceApiContext } from "./api";
import type { ElevenLabs } from "./elevenlabs";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";
import { handleCreateUpload, handleRegister, handleResume } from "./voice-profile-api";
import type { ConsentKind } from "./voice-store";

const OWNER = "user-owner";
const OTHER_USER = "user-other";
const REF = new Blob(["ref-audio"]);
const PHRASE_IDS = PHRASES.map((p) => p.id);

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
    synthesizePhrase: vi.fn<ElevenLabs["synthesizePhrase"]>(async (phraseId: PhraseId, voiceId: string) => ({
      audio: new TextEncoder().encode(`${phraseId}@${voiceId}`).buffer as ArrayBuffer,
      charCount: getPhraseText(phraseId).length,
    })),
  };
}

function setup(kinds: ConsentKind[] = ["voice_self", "overseas_transfer"], userId = OWNER) {
  const store = createMemoryVoiceStore();
  const subjectId = store.seedSubject(OWNER);
  for (const kind of kinds) store.seedConsent(subjectId, kind);
  const tts = fakeTts();
  const ctx: VoiceApiContext = { userId, store, tts };
  return { ctx, store, tts, subjectId };
}

async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

// 보호자 화면의 순서: 업로드 URL 발급 → 서명 URL로 참조 음성 업로드 → 등록
async function uploadRef(env: ReturnType<typeof setup>): Promise<string> {
  const res = await handleCreateUpload(env.ctx, { subject_id: env.subjectId, source: "self" });
  const { path } = (await bodyOf(res)) as { path: string };
  env.store.refs.set(path, REF);
  return path;
}

// 3번째 문장 합성이 실패해 2문장만 저장된 프로필을 등록 라우트로 만든다
async function registerIncomplete() {
  const env = setup();
  const path = await uploadRef(env);
  const synthesize = env.tts.synthesizePhrase.getMockImplementation()!;
  env.tts.synthesizePhrase.mockImplementation(async (phraseId, voiceId) => {
    if (phraseId === PHRASES[2].id) throw new Error("합성 실패");
    return synthesize(phraseId, voiceId);
  });
  const res = await handleRegister(env.ctx, { subject_id: env.subjectId, source: "self", ref_audio_path: path });
  env.tts.synthesizePhrase.mockImplementation(synthesize);
  return { ...env, res };
}

describe("handleCreateUpload", () => {
  it("정상 → 200 {path, signed_url, token}, path는 '{subject_id}/'로 시작", async () => {
    const env = setup();
    const res = await handleCreateUpload(env.ctx, { subject_id: env.subjectId, source: "self" });

    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["path", "signed_url", "token"]);
    expect(body.path).toEqual(expect.stringMatching(new RegExp(`^${env.subjectId}/[^/]+$`)));
    expect(body.signed_url).toBe(`memory://voice-refs/${body.path}?upload`);
    expect(body.token).toBe(`token:${body.path}`);
  });

  it("동의 없음 → 409 {missing}", async () => {
    const env = setup(["voice_self"]);
    const res = await handleCreateUpload(env.ctx, { subject_id: env.subjectId, source: "self" });

    expect(res.status).toBe(409);
    expect(await bodyOf(res)).toEqual({ error: "consent_required", missing: ["overseas_transfer"] });
  });

  it("남의 대상자 → 403", async () => {
    const env = setup(undefined, OTHER_USER);
    const res = await handleCreateUpload(env.ctx, { subject_id: env.subjectId, source: "self" });

    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: "forbidden" });
  });

  it.each([
    [{ source: "preset" }],
    [{ source: undefined }],
    [{ subject_id: "not-a-uuid" }],
  ])("잘못된 입력 %o → 400", async (override) => {
    const env = setup();
    const res = await handleCreateUpload(env.ctx, { subject_id: env.subjectId, source: "self", ...override });

    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "bad_request" });
  });
});

describe("handleRegister", () => {
  it("정상 → 201 {profile_id, voice_id, preview_url}, 프로필 생성", async () => {
    const env = setup();
    const path = await uploadRef(env);
    const res = await handleRegister(env.ctx, { subject_id: env.subjectId, source: "self", ref_audio_path: path });

    expect(res.status).toBe(201);
    const body = await bodyOf(res);
    expect(Object.keys(body).sort()).toEqual(["preview_url", "profile_id", "voice_id"]);
    expect(body.voice_id).toBe("cloned_v");
    expect(env.store.profiles.map((p) => p.id)).toEqual([body.profile_id]);
    expect(env.store.rows).toHaveLength(PHRASES.length);
  });

  it("사전 합성 도중 실패 → 502 {error: 'precompute_incomplete', profile_id}", async () => {
    const { res, store } = await registerIncomplete();

    expect(res.status).toBe(502);
    expect(await bodyOf(res)).toEqual({ error: "precompute_incomplete", profile_id: store.profiles[0].id });
    expect(store.rows).toHaveLength(2);
  });

  it.each([[undefined], [123], [null]])("ref_audio_path가 문자열이 아니면(%o) 400, 클론하지 않는다", async (refAudioPath) => {
    const env = setup();
    const res = await handleRegister(env.ctx, { subject_id: env.subjectId, source: "self", ref_audio_path: refAudioPath });

    expect(res.status).toBe(400);
    expect(env.tts.cloneVoice).not.toHaveBeenCalled();
  });

  it("다른 대상자의 참조 음성 경로 → 403 (경로 규칙은 registerVoiceProfile이 검사)", async () => {
    const env = setup();
    const res = await handleRegister(env.ctx, {
      subject_id: env.subjectId,
      source: "self",
      ref_audio_path: `${env.subjectId}/../other/ref`,
    });

    expect(res.status).toBe(403);
    expect(env.tts.cloneVoice).not.toHaveBeenCalled();
  });

  it("본문에 text·phrase_id·voice_id를 넣어도 무시한다 — 합성 문장은 PHRASES뿐, 목소리는 클론 결과", async () => {
    const env = setup();
    const path = await uploadRef(env);
    const res = await handleRegister(env.ctx, {
      subject_id: env.subjectId,
      source: "self",
      ref_audio_path: path,
      text: "임의 문장을 말해",
      phrase_id: "arbitrary",
      voice_id: "attacker_voice",
    });

    expect(res.status).toBe(201);
    const calls = env.tts.synthesizePhrase.mock.calls;
    expect(calls.map(([phraseId]) => phraseId)).toEqual(PHRASE_IDS);
    expect(calls.every(([, voiceId]) => voiceId === "cloned_v")).toBe(true);
  });
});

describe("handleResume", () => {
  it("502로 받은 profile_id로 재시도 → 200, 남은 문장만 합성", async () => {
    const { ctx, store, tts, subjectId, res } = await registerIncomplete();
    const { profile_id } = (await bodyOf(res)) as { profile_id: string };
    tts.synthesizePhrase.mockClear();

    const retry = await handleResume(ctx, profile_id, { subject_id: subjectId, text: "임의 문장을 말해" });

    expect(retry.status).toBe(200);
    const remaining = PHRASE_IDS.filter((id) => id !== PHRASE_IDS[0] && id !== PHRASE_IDS[1]);
    expect(await bodyOf(retry)).toEqual({ synthesized: remaining, skipped: PHRASE_IDS.slice(0, 2) });
    expect(tts.synthesizePhrase.mock.calls.map(([phraseId]) => phraseId)).toEqual(remaining);
    expect(store.rows).toHaveLength(PHRASES.length);
  });

  it.each([
    ["profile_id", "not-a-uuid", undefined],
    ["subject_id", undefined, "not-a-uuid"],
  ])("잘못된 %s → 400, 합성하지 않는다", async (_field, profileId, subjectId) => {
    const env = setup();
    const res = await handleResume(env.ctx, profileId ?? randomUUID(), {
      subject_id: subjectId ?? env.subjectId,
    });

    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "bad_request" });
    expect(env.tts.synthesizePhrase).not.toHaveBeenCalled();
  });

  it("남의 대상자 → 403", async () => {
    const { store, tts, subjectId, res } = await registerIncomplete();
    const { profile_id } = (await bodyOf(res)) as { profile_id: string };
    tts.synthesizePhrase.mockClear();

    const retry = await handleResume({ userId: OTHER_USER, store, tts }, profile_id, { subject_id: subjectId });

    expect(retry.status).toBe(403);
    expect(tts.synthesizePhrase).not.toHaveBeenCalled();
  });
});
