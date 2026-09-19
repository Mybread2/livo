import { getVoiceApiContext } from "@/services/api";
import { handleListPresets } from "@/services/voice-preset-api";

export const runtime = "nodejs";

// GET /api/voice-presets — 보호자가 고를 수 있는 프리셋 목소리와 미리듣기 URL. voice_id는 내보내지 않는다.
export async function GET() {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  return handleListPresets(ctx);
}
