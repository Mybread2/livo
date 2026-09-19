import "server-only";
import { errorResponse, parseUuid, type VoiceApiContext } from "./api";
import { getBundle } from "./bundle";
import { deleteSubject, revokeConsent } from "./purge";

// 번들·철회·대상자 삭제 라우트의 핸들러. 경로 파라미터 형식만 검사하고 권한 규칙은 bundle.ts·purge.ts에 맡긴다.

// GET /api/bundle/[subject_id] → 200 { voice, recognizer: null }
export async function handleBundle(ctx: VoiceApiContext, subjectId: string): Promise<Response> {
  try {
    const voice = await getBundle(
      { store: ctx.store },
      { userId: ctx.userId, subjectId: parseUuid(subjectId, "subject_id") },
    );
    // recognizer는 B 담당(인식기 번들) 자리다. 서명 URL이 들어 있어 캐시되면 안 된다
    return Response.json({ voice, recognizer: null }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/consents/[consent_id]/revoke → 200 { purged_profile_ids }
export async function handleRevokeConsent(ctx: VoiceApiContext, consentId: string): Promise<Response> {
  try {
    const { purgedProfileIds } = await revokeConsent(
      { store: ctx.store, tts: ctx.tts },
      { userId: ctx.userId, consentId: parseUuid(consentId, "consent_id") },
    );
    return Response.json({ purged_profile_ids: purgedProfileIds });
  } catch (err) {
    return errorResponse(err);
  }
}

// DELETE /api/subjects/[subject_id] → 204
export async function handleDeleteSubject(ctx: VoiceApiContext, subjectId: string): Promise<Response> {
  try {
    await deleteSubject(
      { store: ctx.store, tts: ctx.tts },
      { userId: ctx.userId, subjectId: parseUuid(subjectId, "subject_id") },
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
