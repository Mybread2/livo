import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/bundle/:subject_id — 인식기·사전 합성 오디오 서명 URL 묶음.
// 단말이 오프라인 발화에 필요한 것을 내려받는다.
// 골격 스텁 — 실제 서명 URL 발급은 다음 단계.
export async function GET(
  _request: Request,
  { params }: { params: { subject_id: string } },
) {
  return NextResponse.json({
    subjectId: params.subject_id,
    recognizer: null,
    phraseAudio: [],
    note: "미구현: bundle 발급은 다음 단계",
  });
}
