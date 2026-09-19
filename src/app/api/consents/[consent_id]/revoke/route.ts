import { getVoiceApiContext } from "@/services/api";
import { handleRevokeConsent } from "@/services/bundle-purge-api";

export const runtime = "nodejs";
// 여러 프로필 파기 (ElevenLabs voice + Storage)
export const maxDuration = 60;

// POST /api/consents/:consent_id/revoke — 동의 철회 + 목소리 파기. 클라이언트는 consents를 직접 update할 수 없다.
export async function POST(_req: Request, { params }: { params: { consent_id: string } }) {
  const ctx = await getVoiceApiContext();
  if (ctx instanceof Response) return ctx;
  return handleRevokeConsent(ctx, params.consent_id);
}
