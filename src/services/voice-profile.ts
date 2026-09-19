import "server-only";
import { randomUUID } from "node:crypto";
import { PHRASES } from "@/lib/phrases";
import type { ElevenLabs } from "./elevenlabs";
import { precomputeProfileAudio, profileAudioPath } from "./precompute";
import type { ConsentKind, VoiceSource, VoiceStore } from "./voice-store";

export type { VoiceSource } from "./voice-store";

const PREVIEW_URL_EXPIRES_SEC = 600;

// 가족 음성은 가족 본인 동의가 필요하다 — voice_self로 대신할 수 없다
const VOICE_CONSENT: Record<VoiceSource, ConsentKind> = { self: "voice_self", family: "voice_family" };

export class ForbiddenError extends Error {
  constructor() {
    super("이 대상자에 대한 권한이 없다");
    this.name = "ForbiddenError";
  }
}

export class ConsentRequiredError extends Error {
  missing: ConsentKind[];

  constructor(missing: ConsentKind[]) {
    super(`동의가 필요하다: ${missing.join(", ")}`);
    this.name = "ConsentRequiredError";
    this.missing = missing;
  }
}

async function assertOwnsSubject(store: VoiceStore, userId: string, subjectId: string): Promise<void> {
  if (!(await store.ownsSubject(userId, subjectId))) throw new ForbiddenError();
}

// 철회되지 않은 음성 동의 + overseas_transfer(ElevenLabs는 해외 API)가 있어야 한다.
// 프로필에 연결할 음성 동의(가장 최근 것)와 원본 보관 동의 여부를 돌려준다.
async function requireVoiceConsents(
  store: VoiceStore,
  subjectId: string,
  source: VoiceSource,
): Promise<{ consentId: string; retainRef: boolean }> {
  const consents = await store.listActiveConsents(subjectId);
  const voiceKind = VOICE_CONSENT[source];
  const required: ConsentKind[] = [voiceKind, "overseas_transfer"];
  const missing = required.filter((kind) => !consents.some((c) => c.kind === kind));
  if (missing.length > 0) throw new ConsentRequiredError(missing);

  const latest = consents
    .filter((c) => c.kind === voiceKind)
    .reduce((a, b) => (Date.parse(b.grantedAt) > Date.parse(a.grantedAt) ? b : a));
  return { consentId: latest.id, retainRef: consents.some((c) => c.kind === "voice_retention") };
}

// createRefAudioUpload가 발급한 '{subjectId}/{uuid}' 형태만 받는다. 한 단계 경로라 '..'로 다른 대상자를 가리킬 수 없다.
function isOwnRefPath(subjectId: string, path: string): boolean {
  const prefix = `${subjectId}/`;
  const name = path.slice(prefix.length);
  return path.startsWith(prefix) && name !== "" && !name.includes("/");
}

// 보호자가 참조 음성을 올릴 서명 URL. 동의 없이 참조 음성을 받지 않는다.
export async function createRefAudioUpload(
  deps: { store: VoiceStore },
  input: { userId: string; subjectId: string; source: VoiceSource },
): Promise<{ path: string; signedUrl: string; token: string }> {
  const { store } = deps;
  const { userId, subjectId, source } = input;
  await assertOwnsSubject(store, userId, subjectId);
  await requireVoiceConsents(store, subjectId, source);

  const path = `${subjectId}/${randomUUID()}`;
  const { signedUrl, token } = await store.createRefUploadUrl(path);
  return { path, signedUrl, token };
}

// POST /api/voice-profile의 본체. 권한·동의 검사는 여기서 한다 — 라우트는 얇은 래퍼다.
// 입력에 텍스트가 없다. 합성과 미리듣기는 등록 문장(PHRASES)으로만 한다.
export async function registerVoiceProfile(
  deps: { store: VoiceStore; tts: Pick<ElevenLabs, "cloneVoice" | "deleteVoice" | "synthesizePhrase"> },
  input: { userId: string; subjectId: string; source: VoiceSource; refAudioPath: string },
): Promise<{ profile_id: string; voice_id: string; preview_url: string }> {
  const { store, tts } = deps;
  const { userId, subjectId, source, refAudioPath } = input;
  await assertOwnsSubject(store, userId, subjectId);
  if (!isOwnRefPath(subjectId, refAudioPath)) throw new ForbiddenError();
  // 동의 확인이 끝나기 전에는 참조 음성을 내려받지도, ElevenLabs를 부르지도 않는다
  const { consentId, retainRef } = await requireVoiceConsents(store, subjectId, source);

  const ref = await store.downloadRef(refAudioPath);
  // voice 이름에 대상자 이름 같은 개인정보를 넣지 않는다
  const { voiceId } = await tts.cloneVoice({ name: `livo-${subjectId}`, files: [ref] });

  let profileId: string;
  try {
    ({ id: profileId } = await store.insertVoiceProfile({
      subjectId,
      source,
      refAudioPath,
      providerVoiceId: voiceId,
      consentId,
    }));
  } catch (err) {
    // 프로필 없는 voice는 슬롯만 차지한다. 회수가 실패해도 원래 오류를 던진다.
    await tts.deleteVoice(voiceId).catch(() => {});
    throw err;
  }

  // 원본 파기 (기획서 §6.3). 파일을 먼저 지운다 — 경로만 지우고 파일이 남는 일이 없게.
  if (!retainRef) {
    await store.deleteRef(refAudioPath);
    await store.clearRefAudioPath(profileId);
  }

  await precomputeProfileAudio({ store, tts }, { subjectId, voiceProfileId: profileId, voiceId });

  const previewUrl = await store.signedAudioUrl(
    profileAudioPath(subjectId, profileId, PHRASES[0].id),
    PREVIEW_URL_EXPIRES_SEC,
  );
  return { profile_id: profileId, voice_id: voiceId, preview_url: previewUrl };
}
