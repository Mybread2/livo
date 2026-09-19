import { errorResponse, getVoiceApiContext, readJsonObject } from "@/services/api";
import { handleResume } from "@/services/voice-profile-api";

export const runtime = "nodejs";
// 남은 문장 순차 합성 (최대 15문장)
export const maxDuration = 60;

// POST /api/voice-profile/:profile_id/precompute — 사전 합성 재시도(남은 문장만). 권한·동의 검사는 서버 함수가 한다.
export async function POST(req: Request, { params }: { params: { profile_id: string } }) {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  try {
    return await handleResume(ctx, params.profile_id, await readJsonObject(req));
  } catch (err) {
    return errorResponse(err);
  }
}
