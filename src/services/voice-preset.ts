import "server-only";
import type { PhraseId } from "@/lib/phrases";
import { isVoicePresetKey, VOICE_PRESETS, type VoicePresetKey } from "@/lib/voice-presets";
import { BadRequestError } from "./api";
import { isPresetComplete } from "./precompute";
import { presetAudioPath } from "./presets";
import { ForbiddenError } from "./voice-profile";
import type { VoiceStore } from "./voice-store";

// 미리듣기 문장 "자세 바꿔주세요" — 목소리를 비교할 만큼 길고 응급 문장이 아니다
export const PREVIEW_PHRASE_ID: PhraseId = "reposition";

const DEFAULT_PREVIEW_EXPIRES_SEC = 600;

// 보호자가 미리듣기로 고를 수 있는 프리셋. 합성이 덜 된 프리셋은 고르면 일부 문장이 안 나오므로 빼고, 순서는 팔레트 순서다.
// voice_id는 넣지 않는다 (presets.ts).
export async function listVoicePresets(
  deps: { store: VoiceStore },
  input: { expiresInSec?: number },
): Promise<{ key: VoicePresetKey; label: string; gender: string; ageBand: string; previewUrl: string }[]> {
  const { store } = deps;
  const { expiresInSec = DEFAULT_PREVIEW_EXPIRES_SEC } = input;
  const complete = await Promise.all(VOICE_PRESETS.map(({ key }) => isPresetComplete(store, key)));
  return Promise.all(
    VOICE_PRESETS.filter((_, i) => complete[i]).map(async ({ key, label, gender, ageBand }) => ({
      key,
      label,
      gender,
      ageBand,
      previewUrl: await store.signedAudioUrl(presetAudioPath(key, PREVIEW_PHRASE_ID), expiresInSec),
    })),
  );
}

// 대상자의 프리셋 목소리를 고른다. 번들이 읽을 때 다시 확인하지만, 보호자에게는 여기서 바로 잘못을 알린다.
export async function selectVoicePreset(
  deps: { store: VoiceStore },
  input: { userId: string; subjectId: string; presetKey: unknown },
): Promise<{ presetKey: VoicePresetKey }> {
  const { store } = deps;
  const { userId, subjectId, presetKey } = input;
  if (!(await store.ownsSubject(userId, subjectId))) throw new ForbiddenError();
  if (!isVoicePresetKey(presetKey)) throw new BadRequestError("팔레트에 없는 프리셋");
  if (!(await isPresetComplete(store, presetKey))) throw new BadRequestError("합성이 끝나지 않은 프리셋");
  await store.setSubjectVoicePreset(subjectId, presetKey);
  return { presetKey };
}
