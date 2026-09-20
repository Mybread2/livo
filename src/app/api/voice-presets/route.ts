import { getVoiceApiContext } from "@/services/api";
import { handleListPresets } from "@/services/voice-preset-api";
import { isDemoMode } from "@/lib/demo-server";
import { DEMO_PRESETS } from "@/lib/demo";

export const runtime = "nodejs";

// GET /api/voice-presets — 보호자가 고를 수 있는 프리셋 목소리와 미리듣기 URL. voice_id는 내보내지 않는다.
export async function GET() {
  if (isDemoMode()) {
    return Response.json({ presets: DEMO_PRESETS }, { headers: { "Cache-Control": "no-store" } });
  }
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  return handleListPresets(ctx);
}
