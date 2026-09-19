import { errorResponse, getVoiceApiContext, readJsonObject } from "@/services/api";
import { handleSelectPreset } from "@/services/voice-preset-api";

export const runtime = "nodejs";

// PUT /api/subjects/:subject_id/voice-preset — 대상자의 프리셋 목소리를 고른다. 권한·키 검사는 서버 함수가 한다.
export async function PUT(req: Request, { params }: { params: { subject_id: string } }) {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  try {
    return await handleSelectPreset(ctx, params.subject_id, await readJsonObject(req));
  } catch (err) {
    return errorResponse(err);
  }
}
