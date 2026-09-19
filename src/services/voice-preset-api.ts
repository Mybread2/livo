import "server-only";
import { errorResponse, parseUuid, type VoiceApiContext } from "./api";
import { listVoicePresets, selectVoicePreset } from "./voice-preset";

// 목소리 팔레트 라우트의 핸들러. 경로 파라미터 형식만 검사하고 키·완성 여부·권한 규칙은 voice-preset.ts에 맡긴다.

// GET /api/voice-presets → 200 { presets: [{ key, label, gender, age_band, preview_url }] }
export async function handleListPresets(ctx: VoiceApiContext): Promise<Response> {
  try {
    const presets = await listVoicePresets({ store: ctx.store }, {});
    const body = presets.map(({ key, label, gender, ageBand, previewUrl }) => ({
      key,
      label,
      gender,
      age_band: ageBand,
      preview_url: previewUrl,
    }));
    // 미리듣기 서명 URL이 들어 있어 캐시되면 안 된다
    return Response.json({ presets: body }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

// PUT /api/subjects/[subject_id]/voice-preset — { preset_key } → 200 { preset_key }
export async function handleSelectPreset(
  ctx: VoiceApiContext,
  subjectId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  try {
    const { presetKey } = await selectVoicePreset(
      { store: ctx.store },
      { userId: ctx.userId, subjectId: parseUuid(subjectId, "subject_id"), presetKey: body.preset_key },
    );
    return Response.json({ preset_key: presetKey });
  } catch (err) {
    return errorResponse(err);
  }
}
