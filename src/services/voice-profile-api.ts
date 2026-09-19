import "server-only";
import { BadRequestError, errorResponse, parseSource, parseUuid, type VoiceApiContext } from "./api";
import { createRefAudioUpload, registerVoiceProfile, resumePrecompute } from "./voice-profile";

// 목소리 등록 라우트의 핸들러. 입력 형식만 검사하고 권한·동의 규칙은 voice-profile.ts에 맡긴다.
// 본문에서 텍스트·문장·voice_id를 읽지 않는다 — 합성 대상은 서버가 PHRASES로 정한다. 알 수 없는 필드는 무시한다.

// POST /api/voice-profile/upload-url — { subject_id, source } → 200 { path, signed_url, token }
export async function handleCreateUpload(ctx: VoiceApiContext, body: Record<string, unknown>): Promise<Response> {
  try {
    const subjectId = parseUuid(body.subject_id, "subject_id");
    const source = parseSource(body.source);
    const { path, signedUrl, token } = await createRefAudioUpload(
      { store: ctx.store },
      { userId: ctx.userId, subjectId, source },
    );
    return Response.json({ path, signed_url: signedUrl, token });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/voice-profile — { subject_id, source, ref_audio_path } → 201 { profile_id, voice_id, preview_url }
export async function handleRegister(ctx: VoiceApiContext, body: Record<string, unknown>): Promise<Response> {
  try {
    const subjectId = parseUuid(body.subject_id, "subject_id");
    const source = parseSource(body.source);
    // 경로 규칙('{subjectId}/<한 단계>')은 registerVoiceProfile이 검사한다
    if (typeof body.ref_audio_path !== "string") throw new BadRequestError("ref_audio_path가 문자열이 아니다");
    const result = await registerVoiceProfile(
      { store: ctx.store, tts: ctx.tts },
      { userId: ctx.userId, subjectId, source, refAudioPath: body.ref_audio_path },
    );
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

// POST /api/voice-profile/[profile_id]/precompute — { subject_id } → 200 { synthesized, skipped }
export async function handleResume(
  ctx: VoiceApiContext,
  profileId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  try {
    const voiceProfileId = parseUuid(profileId, "profile_id");
    const subjectId = parseUuid(body.subject_id, "subject_id");
    const result = await resumePrecompute(
      { store: ctx.store, tts: ctx.tts },
      { userId: ctx.userId, subjectId, voiceProfileId },
    );
    return Response.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
