import { getVoiceApiContext } from "@/services/api";
import { handleBundle } from "@/services/bundle-purge-api";

export const runtime = "nodejs";

// GET /api/bundle/:subject_id — 단말이 오프라인 발화에 필요한 사전 합성 오디오 서명 URL을 내려받는다. 권한 검사는 서버 함수가 한다.
export async function GET(_req: Request, { params }: { params: { subject_id: string } }) {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  return handleBundle(ctx, params.subject_id);
}
