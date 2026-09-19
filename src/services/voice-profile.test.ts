import { describe, expect, it, vi } from "vitest";
import { getPhraseText, PHRASES, type PhraseId } from "@/lib/phrases";
import type { ElevenLabs } from "./elevenlabs";
import { profileAudioPath } from "./precompute";
import { createMemoryVoiceStore } from "./testing/memory-voice-store";
import {
  ConsentRequiredError,
  createRefAudioUpload,
  ForbiddenError,
  registerVoiceProfile,
  type VoiceSource,
} from "./voice-profile";
import type { ConsentKind } from "./voice-store";

const OWNER = "user-owner";
const OTHER_USER = "user-other";
const REF = new Blob(["ref-audio"]);

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

// 대상자 1명 + 주어진 동의 + 업로드된 참조 음성 1개
function setup(kinds: ConsentKind[]) {
  const store = createMemoryVoiceStore();
  const subjectId = store.seedSubject(OWNER);
  const consentIds = new Map(kinds.map((kind) => [kind, store.seedConsent(subjectId, kind)]));
  const refAudioPath = `${subjectId}/ref-1`;
  store.refs.set(refAudioPath, REF);
  return { store, tts: fakeTts(), subjectId, refAudioPath, consentIds };
}

function input(subjectId: string, refAudioPath: string, source: VoiceSource = "self", userId = OWNER) {
  return { userId, subjectId, source, refAudioPath };
}

describe("registerVoiceProfile", () => {
  it("self + (voice_self, overseas_transfer): 클론 → 프로필 → 원본 파기 → 5문장 사전 합성 → 미리듣기 URL", async () => {
    const { store, tts, subjectId, refAudioPath, consentIds } = setup(["voice_self", "overseas_transfer"]);
    const signed = vi.spyOn(store, "signedAudioUrl");

    const result = await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath));

    expect(tts.cloneVoice).toHaveBeenCalledTimes(1);
    const clone = tts.cloneVoice.mock.calls[0][0];
    expect(clone.name).toBe(`livo-${subjectId}`);
    expect(clone.files).toHaveLength(1);
    expect(clone.files[0]).toBe(REF);

    expect(store.profiles).toEqual([
      {
        id: result.profile_id,
        subjectId,
        source: "self",
        refAudioPath: null,
        providerVoiceId: "cloned_v",
        consentId: consentIds.get("voice_self"),
        createdAt: expect.any(String),
      },
    ]);
    expect(result.voice_id).toBe("cloned_v");
    expect(store.refs.has(refAudioPath)).toBe(false);

    expect(store.rows.filter((r) => r.voiceProfileId === result.profile_id)).toHaveLength(PHRASES.length);
    expect(tts.synthesizePhrase.mock.calls.every(([, voiceId]) => voiceId === "cloned_v")).toBe(true);

    const previewPath = profileAudioPath(subjectId, result.profile_id, PHRASES[0].id);
    expect(signed).toHaveBeenCalledWith(previewPath, 600);
    expect(result.preview_url).toBe(await store.signedAudioUrl(previewPath, 600));
  });

  it("family + (voice_family, overseas_transfer): 프로필의 동의는 voice_family 동의다", async () => {
    const { store, tts, subjectId, refAudioPath, consentIds } = setup(["voice_family", "overseas_transfer"]);

    await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath, "family"));

    expect(store.profiles[0]).toMatchObject({ source: "family", consentId: consentIds.get("voice_family") });
  });

  it("음성 동의가 여럿이면 가장 최근 것을 프로필에 연결한다", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["overseas_transfer"]);
    store.seedConsent(subjectId, "voice_self", { grantedAt: "2026-01-01T00:00:00.000Z" });
    const latest = store.seedConsent(subjectId, "voice_self", { grantedAt: "2026-06-01T00:00:00.000Z" });
    store.seedConsent(subjectId, "voice_self", { grantedAt: "2026-03-01T00:00:00.000Z" });

    await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath));

    expect(store.profiles[0].consentId).toBe(latest);
  });

  it("voice_retention 동의가 있으면 원본을 보관한다", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["voice_self", "overseas_transfer", "voice_retention"]);

    await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath));

    expect(store.refs.get(refAudioPath)).toBe(REF);
    expect(store.profiles[0].refAudioPath).toBe(refAudioPath);
  });

  it("voice_retention이 철회됐으면 원본을 파기한다", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["voice_self", "overseas_transfer"]);
    store.seedConsent(subjectId, "voice_retention", { revokedAt: "2026-09-01T00:00:00.000Z" });

    await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath));

    expect(store.refs.has(refAudioPath)).toBe(false);
    expect(store.profiles[0].refAudioPath).toBeNull();
  });

  it("overseas_transfer가 없으면 ConsentRequiredError — 참조 음성도 ElevenLabs도 건드리지 않는다", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["voice_self"]);
    const download = vi.spyOn(store, "downloadRef");

    const err = await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath)).catch((e) => e);

    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect(err.missing).toEqual(["overseas_transfer"]);
    expect(download).not.toHaveBeenCalled();
    expect(tts.cloneVoice).not.toHaveBeenCalled();
    expect(store.profiles).toHaveLength(0);
  });

  it("voice_self가 철회됐으면 ConsentRequiredError, cloneVoice 0회", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["overseas_transfer"]);
    store.seedConsent(subjectId, "voice_self", { revokedAt: "2026-09-01T00:00:00.000Z" });

    const err = await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath)).catch((e) => e);

    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect(err.missing).toEqual(["voice_self"]);
    expect(tts.cloneVoice).not.toHaveBeenCalled();
  });

  it("family 등록은 voice_self로 대신할 수 없다 → ConsentRequiredError(['voice_family'])", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["voice_self", "overseas_transfer"]);

    const err = await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath, "family")).catch((e) => e);

    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect(err.missing).toEqual(["voice_family"]);
    expect(tts.cloneVoice).not.toHaveBeenCalled();
  });

  it("남의 대상자면 ForbiddenError — store 쓰기 0회, tts 0회", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["voice_self", "overseas_transfer"]);
    const listConsents = vi.spyOn(store, "listActiveConsents");
    const download = vi.spyOn(store, "downloadRef");

    const err = await registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath, "self", OTHER_USER)).catch(
      (e) => e,
    );

    expect(err).toBeInstanceOf(ForbiddenError);
    expect(listConsents).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(store.profiles).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
    expect(store.audio.size).toBe(0);
    expect(store.refs.get(refAudioPath)).toBe(REF);
    expect(tts.cloneVoice).not.toHaveBeenCalled();
    expect(tts.deleteVoice).not.toHaveBeenCalled();
    expect(tts.synthesizePhrase).not.toHaveBeenCalled();
  });

  it("다른 대상자 경로의 refAudioPath면 ForbiddenError", async () => {
    const { store, tts, subjectId } = setup(["voice_self", "overseas_transfer"]);
    const otherSubject = store.seedSubject(OTHER_USER);
    const download = vi.spyOn(store, "downloadRef");

    for (const path of [`${otherSubject}/ref-1`, `${subjectId}/../${otherSubject}/ref-1`, `x${subjectId}/ref-1`]) {
      store.refs.set(path, REF);
      await expect(registerVoiceProfile({ store, tts }, input(subjectId, path))).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    expect(download).not.toHaveBeenCalled();
    expect(tts.cloneVoice).not.toHaveBeenCalled();
  });

  it("insertVoiceProfile이 실패하면 클론한 voice를 지워 슬롯을 회수하고 다시 throw한다", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["voice_self", "overseas_transfer"]);
    vi.spyOn(store, "insertVoiceProfile").mockRejectedValue(new Error("insert 실패"));

    await expect(registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath))).rejects.toThrow("insert 실패");

    expect(tts.deleteVoice).toHaveBeenCalledWith("cloned_v");
    expect(tts.synthesizePhrase).not.toHaveBeenCalled();
  });

  it("슬롯 회수도 실패하면 원래 오류(insert 실패)를 던진다", async () => {
    const { store, tts, subjectId, refAudioPath } = setup(["voice_self", "overseas_transfer"]);
    vi.spyOn(store, "insertVoiceProfile").mockRejectedValue(new Error("insert 실패"));
    tts.deleteVoice.mockRejectedValue(new Error("delete 실패"));

    await expect(registerVoiceProfile({ store, tts }, input(subjectId, refAudioPath))).rejects.toThrow("insert 실패");
  });
});

describe("createRefAudioUpload", () => {
  it("'{subjectId}/'로 시작하는 새 경로의 서명 업로드 URL을 발급한다", async () => {
    const { store, subjectId } = setup(["voice_self", "overseas_transfer"]);
    const createUrl = vi.spyOn(store, "createRefUploadUrl");

    const a = await createRefAudioUpload({ store }, { userId: OWNER, subjectId, source: "self" });
    const b = await createRefAudioUpload({ store }, { userId: OWNER, subjectId, source: "self" });

    expect(a.path.startsWith(`${subjectId}/`)).toBe(true);
    expect(a.path).not.toBe(b.path);
    expect(createUrl).toHaveBeenNthCalledWith(1, a.path);
    expect({ signedUrl: a.signedUrl, token: a.token }).toEqual(await store.createRefUploadUrl(a.path));
  });

  it("남의 대상자면 ForbiddenError, URL을 발급하지 않는다", async () => {
    const { store, subjectId } = setup(["voice_self", "overseas_transfer"]);
    const createUrl = vi.spyOn(store, "createRefUploadUrl");

    await expect(
      createRefAudioUpload({ store }, { userId: OTHER_USER, subjectId, source: "self" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("동의가 없으면 ConsentRequiredError, URL을 발급하지 않는다", async () => {
    const { store, subjectId } = setup(["voice_self"]);
    const createUrl = vi.spyOn(store, "createRefUploadUrl");

    const err = await createRefAudioUpload({ store }, { userId: OWNER, subjectId, source: "self" }).catch((e) => e);

    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect(err.missing).toEqual(["overseas_transfer"]);
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("family 업로드에 voice_self만 있으면 ConsentRequiredError(['voice_family'])", async () => {
    const { store, subjectId } = setup(["voice_self", "overseas_transfer"]);

    const err = await createRefAudioUpload({ store }, { userId: OWNER, subjectId, source: "family" }).catch((e) => e);

    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect(err.missing).toEqual(["voice_family"]);
  });
});
