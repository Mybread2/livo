import "server-only";
import { ElevenLabsError, type ElevenLabs } from "./elevenlabs";
import { ForbiddenError } from "./voice-profile";
import type { VoiceStore } from "./voice-store";

type PurgeDeps = { store: VoiceStore; tts: Pick<ElevenLabs, "deleteVoice">; now?: () => Date };

// 참조 음성과 목소리는 요청 시 즉시 파기한다 (기획서 §6.3). DB cascade는 행만 지운다 —
// ElevenLabs voice와 Storage 파일은 여기서 지워야 하고, 지울 대상(voice_id·경로)은 행에 있으므로 행은 항상 마지막에 지운다.

// 멱등이다. 중간에 실패하면 행이 남아 있으므로 다시 불러 이어서 끝낸다.
export async function purgeVoiceProfile(deps: PurgeDeps, voiceProfileId: string): Promise<void> {
  const { store, tts } = deps;
  const profile = await store.getVoiceProfile(voiceProfileId);
  if (!profile) return;

  try {
    await tts.deleteVoice(profile.providerVoiceId);
  } catch (err) {
    // 404는 이전 시도에서 이미 지워진 것이다. 그 외 실패는 호출자가 재시도해야 하므로 삼키지 않는다
    if (!(err instanceof ElevenLabsError && err.status === 404)) throw err;
  }
  const rows = await store.listPhraseAudio(voiceProfileId);
  await store.deleteAudio(rows.map((r) => r.audioPath));
  if (profile.refAudioPath !== null) await store.deleteRef(profile.refAudioPath);
  await store.deleteVoiceProfile(voiceProfileId);
}

// 등록되지 않은 업로드까지 대상자의 참조 음성 파일 전부
async function deleteAllRefs(store: VoiceStore, subjectId: string): Promise<void> {
  for (const path of await store.listRefs(subjectId)) await store.deleteRef(path);
}

// 동의 철회의 본체. 클라이언트는 consents를 직접 update할 수 없다 — 철회는 파기를 동반해야 한다.
// 이미 철회된 동의에 다시 불러도 파기를 다시 수행한다 (파기 실패 후 재시도 경로).
export async function revokeConsent(
  deps: PurgeDeps,
  input: { userId: string; consentId: string },
): Promise<{ purgedProfileIds: string[] }> {
  const { store, now = () => new Date() } = deps;
  const consent = await store.getConsent(input.consentId);
  // 없는 동의와 남의 동의를 구분하지 않는다 — 존재 여부를 드러내지 않는다
  if (!consent || !(await store.ownsSubject(input.userId, consent.subjectId))) throw new ForbiddenError();
  const { id, subjectId, kind } = consent;

  // 파기보다 먼저 기록한다. 파기가 실패해도 번들은 철회된 동의의 목소리를 내보내지 않는다
  await store.revokeConsent(id, now());

  let targets: string[] = [];
  switch (kind) {
    case "voice_self":
    case "voice_family":
      targets = (await store.listVoiceProfiles(subjectId)).filter((p) => p.consentId === id).map((p) => p.id);
      break;
    // 클로닝 목소리는 해외 API에 있다 — 음성 동의 종류와 상관없이 전부 파기한다
    case "overseas_transfer":
      targets = (await store.listVoiceProfiles(subjectId)).map((p) => p.id);
      break;
    // 파일을 먼저 지운다 — 경로만 지우고 파일이 남는 일이 없게
    case "voice_retention":
      await deleteAllRefs(store, subjectId);
      for (const p of await store.listVoiceProfiles(subjectId)) await store.clearRefAudioPath(p.id);
      break;
  }
  for (const profileId of targets) await purgeVoiceProfile(deps, profileId);
  return { purgedProfileIds: targets };
}

// 대상자 삭제의 본체. 클라이언트는 subjects를 직접 delete할 수 없다.
// 계정 삭제는 다른 담당의 데이터도 걸려 있어 여기서 다루지 않는다.
export async function deleteSubject(deps: PurgeDeps, input: { userId: string; subjectId: string }): Promise<void> {
  const { store } = deps;
  const { userId, subjectId } = input;
  if (!(await store.ownsSubject(userId, subjectId))) throw new ForbiddenError();

  for (const p of await store.listVoiceProfiles(subjectId)) await purgeVoiceProfile(deps, p.id);
  await deleteAllRefs(store, subjectId);
  await store.deleteSubject(subjectId);
}
