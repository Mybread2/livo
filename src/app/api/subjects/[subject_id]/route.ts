import { getVoiceApiContext } from "@/services/api";
import { handleDeleteSubject } from "@/services/bundle-purge-api";

export const runtime = "nodejs";
// 대상자의 프로필 전부 파기 (ElevenLabs voice + Storage)
export const maxDuration = 60;

// DELETE /api/subjects/:subject_id — 목소리 파기 후 대상자 삭제. 클라이언트는 subjects를 직접 delete할 수 없다.
export async function DELETE(_req: Request, { params }: { params: { subject_id: string } }) {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  return handleDeleteSubject(ctx, params.subject_id);
}
