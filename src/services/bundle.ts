import "server-only";
import { PHRASES, type PhraseId } from "@/lib/phrases";
import { DEFAULT_VOICE_PRESET } from "@/lib/voice-presets";
import type { VoiceBundle } from "@/types/voice-bundle";
import { presetAudioPath } from "./presets";
import { ForbiddenError } from "./voice-profile";
import type { VoiceStore } from "./voice-store";

const DEFAULT_EXPIRES_SEC = 3600;

type ChosenVoice = Pick<VoiceBundle, "version" | "source"> & { paths: { phraseId: PhraseId; path: string }[] };

// 최신 프로필부터 보고, 모든 등록 문장의 오디오가 있는 첫 프로필을 고른다. 최신 프로필이 아직 사전 합성 중이면
// 이전 목소리를 준다 — 교체 중에도 발화가 끊기지 않게. 부분 완료 프로필은 내보내지 않는다(일부 문장만 소리가 난다).
// 동의가 살아 있는 프로필만 후보다 — 철회 후 파기가 실패해 오디오가 남아 있어도 그 목소리는 나가지 않는다.
// 클로닝 목소리는 해외 API에서 만든 것이라 overseas_transfer 동의도 살아 있어야 한다.
async function chooseVoice(store: VoiceStore, subjectId: string): Promise<ChosenVoice> {
  const consents = await store.listActiveConsents(subjectId);
  const profiles = consents.some((c) => c.kind === "overseas_transfer") ? await store.listVoiceProfiles(subjectId) : [];
  for (const { id, source, consentId } of profiles) {
    if (!consents.some((c) => c.id === consentId)) continue;
    const rows = await store.listPhraseAudio(id);
    const paths = PHRASES.flatMap(({ id: phraseId }) => {
      const row = rows.find((r) => r.phraseId === phraseId);
      return row ? [{ phraseId, path: row.audioPath }] : [];
    });
    if (paths.length === PHRASES.length) return { version: id, source, paths };
  }
  // 응급 발화는 목소리 등록 여부와 상관없이 나가야 한다
  return {
    version: `preset:${DEFAULT_VOICE_PRESET}`,
    source: "preset",
    paths: PHRASES.map(({ id }) => ({ phraseId: id, path: presetAudioPath(DEFAULT_VOICE_PRESET, id) })),
  };
}

// GET /api/bundle/:subject_id의 본체. 권한 검사는 여기서 한다 — 라우트는 얇은 래퍼다.
// 번들에는 재생할 오디오의 서명 URL만 넣는다. voice_id·참조 음성 경로는 서버 밖으로 내보내지 않는다.
export async function getBundle(
  deps: { store: VoiceStore; now?: () => Date },
  input: { userId: string; subjectId: string; expiresInSec?: number },
): Promise<VoiceBundle> {
  const { store, now = () => new Date() } = deps;
  const { userId, subjectId, expiresInSec = DEFAULT_EXPIRES_SEC } = input;
  if (!(await store.ownsSubject(userId, subjectId))) throw new ForbiddenError();

  // 서명보다 먼저 잰다 — expiresAt이 실제 만료보다 늦을 일이 없다
  const expiresAt = new Date(now().getTime() + expiresInSec * 1000).toISOString();
  const { version, source, paths } = await chooseVoice(store, subjectId);
  const items = await Promise.all(
    paths.map(async ({ phraseId, path }) => ({ phraseId, url: await store.signedAudioUrl(path, expiresInSec) })),
  );
  return { version, source, items, expiresAt };
}
