import { errorResponse, getVoiceApiContext, readJsonObject } from "@/services/api";
import { handleRegister } from "@/services/voice-profile-api";

export const runtime = "nodejs";
// 클론 + 15문장 순차 합성
export const maxDuration = 60;

// POST /api/voice-profile — 참조 음성 → ElevenLabs voice 등록 → 사전 합성. 권한·동의 검사는 서버 함수가 한다.
export async function POST(req: Request) {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  try {
    return await handleRegister(ctx, await readJsonObject(req));
  } catch (err) {
    return errorResponse(err);
  }
}
