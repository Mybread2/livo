import { errorResponse, getVoiceApiContext, readJsonObject } from "@/services/api";
import { handleCreateUpload } from "@/services/voice-profile-api";

export const runtime = "nodejs";

// POST /api/voice-profile/upload-url — 참조 음성 업로드용 서명 URL. 권한·동의 검사는 서버 함수가 한다.
export async function POST(req: Request) {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  try {
    return await handleCreateUpload(ctx, await readJsonObject(req));
  } catch (err) {
    return errorResponse(err);
  }
}
